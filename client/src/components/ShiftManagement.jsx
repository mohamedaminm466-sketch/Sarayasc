import React, {
  useEffect,
  useState
} from 'react'
import './ShiftManagement.css'

import {
  useAuth
} from '../App'

import api from '../api'

import {
  format,
  formatDistanceToNow
} from 'date-fns'

const emptyMetrics = {
  water05Sold: 0,
  water1Sold: 0,
  water15Sold: 0,
  waterBolarSold: 0,
  kamia: 0,
  eau05Used: 0,
  express: 0,
  cappuccino: 0,
  americain: 0,
  filter: 0,
  direct: 0,
  chichaTotal: 0,
  chichaPersonnel: 0,
  sodaSold: 0,
  cannettesSold: 0
}

const canEditShift = (shiftStartTime) => {
  const now = new Date()
  const start = new Date(shiftStartTime)
  const minutesSinceStart = (now - start) / (1000 * 60)
  return minutesSinceStart < 15
}

const ShiftManagement = () => {

  const { user } =
    useAuth()

  const isAdmin =
    user?.role === 'admin'

  const [shifts, setShifts] =
    useState([])

  const [activeShift, setActiveShift] =
    useState(null)

  const [stock, setStock] =
    useState([])

  const [loading, setLoading] =
    useState(true)

  const [showStartForm, setShowStartForm] =
    useState(false)

  const [showEndForm, setShowEndForm] =
    useState(false)

  const [showPreview, setShowPreview] =
    useState(false)

  const [showAddStockForm, setShowAddStockForm] =
    useState(false)

  const [selectedShift, setSelectedShift] =
    useState(null)

  const [formData, setFormData] =
    useState({})

  const [allocations, setAllocations] =
    useState({})

  const [closingStock, setClosingStock] =
    useState({})

  const [shiftMetrics, setShiftMetrics] =
    useState(emptyMetrics)

  const [previewData, setPreviewData] =
    useState(null)

  // End-of-shift financial declarations
  const [financialData, setFinancialData] =
    useState({
      expensesAmount: '',
      expensesNote: '',
      staffSalary: '',
      manqueNote: ''
    })

  // Final phase fields
  const [actualCashCounted, setActualCashCounted] = useState('')
  const [finalShiftNote, setFinalShiftNote] = useState('')

  const [message, setMessage] =
    useState({
      type: '',
      text: ''
    })

  const [staffPrices, setStaffPrices] =
    useState({
      coffee: 0,
      water: 0,
      soda: 0,
      cannette: 0
    })

  // Adjustments chosen by the worker from Vendu vs Consommé
  const [recetteAdjustments, setRecetteAdjustments] = useState({})

  // When EAU 0.5 consumed > sold, the worker can classify
  // the excess as CHICHA and/or EAU 0.5.
  const [water05Classification, setWater05Classification] = useState({
    chicha: 0,
    water: 0
  })

  // NEW: When EAU 0.5 sold > consumed, the worker can choose
  // which product to deduct from (Chicha or Eau 0.5)
  const [water05Deduction, setWater05Deduction] = useState({
    chicha: 0,
    water: 0
  })

  // Professional end-shift wizard
  const [endShiftStep, setEndShiftStep] = useState(0)
  const [comparisonEdits, setComparisonEdits] = useState({})
  const [ramiPaperStock, setRamiPaperStock] = useState(null)
  const [ramiPaperClosing, setRamiPaperClosing] = useState('')
  const [ramiPaperAdding, setRamiPaperAdding] = useState('')
  const [ramiPaperLoading, setRamiPaperLoading] = useState(false)
  const [chichaPrice, setChichaPrice] = useState(0)
  const [finalizedSummary, setFinalizedSummary] = useState(null)

  // Loading state for start form
  const [startFormLoading, setStartFormLoading] = useState(false)

  const getNumber = value => parseFloat(value) || 0
  const fixed = value => Number(value || 0).toFixed(2)

  const getProductPrice = keywords => {
    const item = stock.find(row => {
      const name = `${row.name || ''} ${row.display_name || ''}`.toLowerCase()
      return keywords.some(keyword => name.includes(keyword))
    })
    return parseFloat(item?.price) || 0
  }

  // ============================================================
  // getChichaPriceFromStock - gets price from stock items
  // ============================================================
  const getChichaPriceFromStock = () => {
    const chichaItem = stock.find(item => {
      const name = `${item.name || ''} ${item.display_name || ''}`.toLowerCase()
      return name.includes('chicha') || name.includes('shisha')
    })
    if (chichaItem && chichaItem.price) {
      return parseFloat(chichaItem.price)
    }
    
    const price = getProductPrice(['chicha', 'shisha'])
    if (price > 0) {
      return price
    }
    
    return 0
  }

  const calculateStockAdjustment = metrics => {
    const rows = [
      { label: 'EAU 0.5', sold: (parseFloat(metrics.water05Sold) || 0) + (parseFloat(metrics.kamia) || 0), consumed: parseFloat(metrics.water05Consumed) || 0, price: getProductPrice(['eau05','eau 0.5','water05','water 0.5']) },
      { label: 'EAU 1L', sold: parseFloat(metrics.water1Sold) || 0, consumed: parseFloat(metrics.water1Consumed) || 0, price: getProductPrice(['eau1','eau 1','water1','water 1']) },
      { label: 'EAU 1.5L', sold: parseFloat(metrics.water15Sold) || 0, consumed: parseFloat(metrics.water15Consumed) || 0, price: getProductPrice(['eau15','eau 1.5','water15','water 1.5']) },
      { label: 'Gazeuse', sold: parseFloat(metrics.sodaSold) || 0, consumed: parseFloat(metrics.sodaConsumed) || 0, price: getProductPrice(['soda','gazeuse','gazouse']) },
      { label: 'Cannette', sold: parseFloat(metrics.cannettesSold) || 0, consumed: parseFloat(metrics.cannettesConsumed) || 0, price: getProductPrice(['cannette','canette']) }
    ]
    const total = rows.reduce((sum,row) => sum + ((row.consumed - row.sold) * row.price), 0)
    return { rows, total }
  }

  // ============================================================
  // CHICHA PRICE - source of truth is the admin Stock setting
  // ============================================================
  const fetchChichaPrice = async () => {
    try {
      const response = await api.get('/stock/settings/chicha-price')
      const price = Number(response.data?.chicha_price)
      if (Number.isFinite(price) && price > 0) {
        setChichaPrice(price)
        return price
      }
    } catch (e) {
      console.warn('Could not fetch Chicha price from settings:', e)
    }

    const fromStock = getChichaPriceFromStock()
    if (fromStock > 0) {
      setChichaPrice(fromStock)
      return fromStock
    }

    setChichaPrice(0)
    return 0
  }

  const getCurrentChichaPrice = () => {
    const statePrice = Number(chichaPrice)
    if (Number.isFinite(statePrice) && statePrice > 0) return statePrice

    const fromStock = getChichaPriceFromStock()
    if (fromStock > 0) return fromStock

    return 0
  }

  /*
  ============================================================
  FETCH DATA
  ============================================================
  */

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {

    try {

      const [
        shiftsRes,
        activeRes,
        stockRes,
        staffPricesRes
      ] = await Promise.all([
        api.get('/shifts'),
        api.get('/shifts/active'),
        api.get('/stock'),
        api.get('/stock/staff-prices')
      ])

      setShifts(
        shiftsRes.data
      )

      setStock(
        stockRes.data
      )

      if (staffPricesRes.data) {
        setStaffPrices({
          coffee: parseFloat(staffPricesRes.data.coffee) || 0,
          water: parseFloat(staffPricesRes.data.water) || 0,
          soda: parseFloat(staffPricesRes.data.soda) || 0,
          cannette: parseFloat(staffPricesRes.data.cannette) || 0
        })
      }
      
      await fetchChichaPrice()

      if (
        activeRes.data.active
      ) {

        setActiveShift(
          activeRes.data.shift
        )
        setRamiPaperStock(activeRes.data.shift?.ramiPaperStock || null)

        const savedStage = activeRes.data.shift.endShiftStage || activeRes.data.shift.end_shift_stage || 'idle'
        if (savedStage === 'recording' || savedStage === 'preview') {
          setShowEndForm(true)
          setEndShiftStep(savedStage === 'recording' ? 3 : 1)
        }

        if (activeRes.data.shift.actual_cash_counted !== null && activeRes.data.shift.actual_cash_counted !== undefined) {
          setActualCashCounted(String(activeRes.data.shift.actual_cash_counted))
        }
        if (activeRes.data.shift.final_shift_note) {
          setFinalShiftNote(activeRes.data.shift.final_shift_note)
        }

        const savedShift = activeRes.data.shift
        const savedClosing = savedShift.closing_front_stock || savedShift.closingFrontStock
        if (savedClosing && typeof savedClosing === 'object') {
          setClosingStock(savedClosing)
        }

        const savedWarehouseClosing = savedShift.closing_warehouse_stock || savedShift.closingWarehouseStock
        if (savedWarehouseClosing && typeof savedWarehouseClosing === 'object') {
          setFormData(prev => {
            const next = { ...prev }
            Object.entries(savedWarehouseClosing).forEach(([itemId, quantity]) => {
              next[`warehouse_close_${itemId}`] = quantity
            })
            return next
          })
        }

        const savedStaff = savedShift.staff_consumption || savedShift.staffConsumption || {}
        setFormData(prev => ({
          ...prev,
          cashCollected: savedShift.cash_collected ?? prev.cashCollected ?? '',
          ramiGamesUsed: savedShift.rami_games_used ?? prev.ramiGamesUsed ?? '',
          staffCoffee: savedStaff.coffee ?? prev.staffCoffee ?? '',
          staffWater: savedStaff.water ?? prev.staffWater ?? '',
          staffSoda: savedStaff.soda ?? prev.staffSoda ?? '',
          staffCannette: savedStaff.cannette ?? prev.staffCannette ?? '',
          notes: savedShift.notes ?? prev.notes ?? ''
        }))

        setFinancialData({
          expensesAmount: savedShift.expenses_amount ?? '',
          expensesNote: savedShift.expenses_note ?? '',
          staffSalary: savedShift.staff_salary ?? '',
          manqueNote: savedShift.manque_note ?? ''
        })

        setShiftMetrics(prev => ({
          ...prev,
          water05Sold: savedShift.water_05_sold ?? prev.water05Sold,
          water1Sold: savedShift.water_1_sold ?? prev.water1Sold,
          water15Sold: savedShift.water_15_sold ?? prev.water15Sold,
          waterBolarSold: savedShift.water_bolar_sold ?? prev.waterBolarSold,
          kamia: savedShift.kamia ?? prev.kamia,
          eau05Used: savedShift.eau05_used ?? prev.eau05Used,
          express: savedShift.coffee_express ?? prev.express,
          cappuccino: savedShift.coffee_cappuccino ?? prev.cappuccino,
          americain: savedShift.coffee_americain ?? prev.americain,
          filter: savedShift.coffee_filter ?? prev.filter,
          direct: savedShift.coffee_direct ?? prev.direct,
          chichaTotal: savedShift.chicha_total ?? prev.chichaTotal,
          chichaPersonnel: savedShift.chicha_personnel ?? prev.chichaPersonnel,
          sodaSold: savedShift.soda_sold ?? prev.sodaSold,
          cannettesSold: savedShift.cannettes_sold ?? prev.cannettesSold
        }))

        const savedCorrections = savedShift.correction_actions || savedShift.correctionActions || savedShift.recette_adjustments || savedShift.recetteAdjustments
        if (Array.isArray(savedCorrections)) {
          const mapped = {}
          savedCorrections.forEach(action => {
            if (action?.key || action?.id) mapped[action.key || action.id] = action
          })
          setRecetteAdjustments(mapped)
        }

        const savedClassification = savedShift.chicha_kamia_adjustments || savedShift.chichaKamiaAdjustments
        if (savedClassification && typeof savedClassification === 'object') {
          setWater05Classification({
            chicha: Number(savedClassification.chicha || 0),
            water: Number(savedClassification.water || savedClassification.water05 || 0)
          })
          // Restore deduction as well
          if (savedClassification.deduction) {
            setWater05Deduction({
              chicha: Number(savedClassification.deduction.chicha || 0),
              water: Number(savedClassification.deduction.water || 0)
            })
          }
        }

        if (activeRes.data.shift.hasPreview) {
          loadPreviewData(activeRes.data.shift.id)
        }

        const initialClosing = {}

        (activeRes.data.stock || stockRes.data).forEach(
          item => {

            initialClosing[
              item.id
            ] = ''
          }
        )

        setClosingStock(
          initialClosing
        )
      }

    } catch (error) {

      console.error(
        'Failed to fetch shift data:',
        error
      )

      setMessage({
        type: 'error',
        text:
          error.response?.data?.error ||
          'Failed to load shifts'
      })

    } finally {

      setLoading(false)
    }
  }

  const loadPreviewData = async (shiftId) => {
    try {
      const response = await api.get(`/shifts/${shiftId}`)
      if (response.data) {
        setPreviewData(response.data)
        setShowPreview(true)
      }
    } catch (error) {
      console.error('Failed to load preview:', error)
    }
  }

  /*
  ============================================================
  HANDLE VIEW SHIFT DETAILS - ADMIN
  ============================================================
  */

  const handleViewShiftDetails = async (shiftId) => {
    try {
      setLoading(true)

      const response = await api.get(
        `/shifts/${shiftId}`
      )

      console.log(
        'SHIFT DETAILS FROM BACKEND:',
        response.data
      )

      setSelectedShift(
        response.data
      )

    } catch (error) {

      console.error(
        'Failed to load shift details:',
        error
      )

      setMessage({
        type: 'error',
        text:
          error.response?.data?.error ||
          'Failed to load shift details'
      })

    } finally {
      setLoading(false)
    }
  }

  /*
  ============================================================
  HANDLE SHOW START FORM
  ============================================================
  */

  const handleShowStartForm = async () => {
    if (stock.length === 0) {
      setStartFormLoading(true)
      try {
        const stockRes = await api.get('/stock')
        setStock(stockRes.data)
      } catch (error) {
        console.error('Failed to load stock for start form:', error)
        setMessage({
          type: 'error',
          text: 'Failed to load stock. Please try again.'
        })
        setStartFormLoading(false)
        return
      }
      setStartFormLoading(false)
    }
    setShowStartForm(true)
  }

  /*
  ============================================================
  START SHIFT
  ============================================================
  */

  const handleStartShift =
    async e => {

      e.preventDefault()

      setMessage({
        type: '',
        text: ''
      })

      const initialFrontStock = {}

      Object.keys(formData)
        .forEach(key => {

          if (
            key.startsWith(
              'stock_'
            )
          ) {

            const itemId =
              key.replace(
                'stock_',
                ''
              )

            const quantity =
              parseFloat(
                formData[key]
              ) || 0

            if (
              quantity > 0
            ) {

              initialFrontStock[
                itemId
              ] =
                quantity
            }
          }
        })

      try {

        const response =
          await api.post(
            '/shifts/start',
            {
              initialFrontStock,
              ramiPaperOpening: formData.ramiPaperOpening === '' || formData.ramiPaperOpening == null
                ? undefined
                : Number(formData.ramiPaperOpening)
            }
          )

        setActiveShift(
          response.data.shift
        )

        setStock(
          response.data.stock
        )

        setShowStartForm(
          false
        )

        setFormData({})
        setRamiPaperClosing(String(response.data.shift?.ramiPaperOpening ?? 0))

        setShowPreview(false)
        setPreviewData(null)

        setMessage({
          type: 'success',
          text:
            'Shift started. Remaining stock from the previous shift was carried over automatically.'
        })

        await fetchData()

      } catch (error) {

        setMessage({
          type: 'error',
          text:
            error.response?.data?.error ||
            'Failed to start shift'
        })
      }
    }

  /*
  ============================================================
  PREVIEW SHIFT (Save draft)
  ============================================================
  */

  const handlePreviewShift = async e => {
    e?.preventDefault?.()
    const requestedStage = e?.endShiftStage || 'preview'

    setMessage({
      type: '',
      text: ''
    })

    if (!activeShift) {
      setMessage({ type: 'error', text: 'No active shift found.' })
      return
    }

    try {

      const closingData = {}

      stock.forEach(
        item => {
          if (item.can_be_front === false) return

          const quantity =
            parseFloat(
              closingStock[
                item.id
              ]
            )

          const fallbackCurrent = parseFloat(item.front_quantity) || 0
          closingData[
            item.id
          ] =
            Number.isFinite(
              quantity
            )
              ? Math.max(0, quantity)
              : fallbackCurrent
        }
      )

      const closingWarehouseStock = {}
      stock.forEach(item => {
        if (item.can_be_front === false) {
          const val = formData[`warehouse_close_${item.id}`]
          closingWarehouseStock[item.id] = val === undefined || val === ''
            ? (Number(item.warehouse_quantity) || 0)
            : Number(val)
        }
      })

      const staffCoffeeCount =
        parseInt(
          formData.staffCoffee
        ) || 0

      const staffWaterCount =
        parseInt(
          formData.staffWater
        ) || 0

      const staffSodaCount =
        parseInt(
          formData.staffSoda
        ) || 0

      const staffCannetteCount =
        parseInt(
          formData.staffCannette
        ) || 0

      const staffConsumption = {
        coffee: staffCoffeeCount,
        water: staffWaterCount,
        soda: staffSodaCount,
        cannette: staffCannetteCount
      }

      const metrics = {
        water05Sold:
          parseInt(
            shiftMetrics.water05Sold
          ) || 0,

        water1Sold:
          parseInt(
            shiftMetrics.water1Sold
          ) || 0,

        water15Sold:
          parseInt(
            shiftMetrics.water15Sold
          ) || 0,

        waterBolarSold:
          parseInt(
            shiftMetrics.waterBolarSold
          ) || 0,

        kamia:
          parseInt(
            shiftMetrics.kamia
          ) || 0,

        eau05Used:
          parseInt(
            shiftMetrics.eau05Used
          ) || 0,

        express:
          parseInt(
            shiftMetrics.express
          ) || 0,

        cappuccino:
          parseInt(
            shiftMetrics.cappuccino
          ) || 0,

        americain:
          parseInt(
            shiftMetrics.americain
          ) || 0,

        filter:
          parseInt(
            shiftMetrics.filter
          ) || 0,

        direct:
          parseInt(
            shiftMetrics.direct
          ) || 0,

        chichaTotal:
          parseInt(
            shiftMetrics.chichaTotal
          ) || 0,

        chichaPersonnel:
          parseInt(
            shiftMetrics.chichaPersonnel
          ) || 0,

        sodaSold:
          parseInt(
            shiftMetrics.sodaSold
          ) || 0,

        cannettesSold:
          parseInt(
            shiftMetrics.cannettesSold
          ) || 0
      }

      const correctionActions = getCorrectionActionsPayload() || []

      const requestData = {
        closingFrontStock: closingData,
        closingWarehouseStock: closingWarehouseStock,
        cashCollected: parseFloat(formData.cashCollected) || 0,
        ramiGamesUsed: parseInt(formData.ramiGamesUsed) || 0,
        ramiPaperClosing: ramiPaperClosing === '' || ramiPaperClosing === undefined
          ? 0
          : Math.max(0, parseInt(ramiPaperClosing, 10) || 0),
        staffConsumption: staffConsumption,
        shiftMetrics: metrics,
        financialData: {
          expensesAmount: getNumber(financialData.expensesAmount),
          expensesNote: financialData.expensesNote || '',
          staffSalary: getNumber(financialData.staffSalary)
        },
        recetteAdjustments: recetteAdjustments,
        correctionActions: correctionActions,
        chichaKamiaAdjustments: { 
          ...water05Classification,
          deduction: { ...water05Deduction }
        },
        workerMessage: formData.notes || '',
        actualCashCounted: getNumber(actualCashCounted),
        finalShiftNote: finalShiftNote || '',
        endShiftStage: requestedStage
      }

      console.log('Sending preview request:', requestData)

      const response = await api.post(
        `/shifts/${activeShift.id}/preview`,
        requestData
      )

      setPreviewData(response.data)
      setShowPreview(true)
      setShowEndForm(true)
      setEndShiftStep(requestedStage === 'recording' ? 3 : 1)

      setMessage({
        type: 'success',
        text: requestedStage === 'recording'
          ? '💾 Enregistrement effectué. Le shift est maintenant en attente du comptage réel de la caisse.'
          : '📊 Preview generated! Review the details below. Vous pouvez continuer vers la correction.'
      })

      await fetchData()

    } catch (error) {
      console.error('Preview error details:', error.response?.data || error.message)
      setMessage({
        type: 'error',
        text: error.response?.data?.error || 'Failed to generate preview'
      })
    }
  }

  const handleEnterRecording = async () => {
    await handlePreviewShift({
      preventDefault: () => {},
      endShiftStage: 'recording'
    })
  }

  const handleSaveCashProgress = async () => {
    if (!activeShift) return
    try {
      await api.post(`/shifts/${activeShift.id}/end-progress`, {
        actualCashCounted: actualCashCounted === '' ? null : getNumber(actualCashCounted),
        finalShiftNote: finalShiftNote || '',
        manqueNote: financialData.manqueNote || ''
      })
      setMessage({ type: 'success', text: '💾 Comptage de caisse enregistré.' })
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || 'Impossible d\'enregistrer le comptage.' })
    }
  }

  /*
  ============================================================
  END SHIFT (FINALIZE)
  ============================================================
  */

  const handleEndShift =
    async e => {

      e.preventDefault()

      setMessage({
        type: '',
        text: ''
      })

      if (!activeShift) {
        return
      }

      if (activeShift.isFinalized) {
        setMessage({
          type: 'error',
          text: '⛔ This shift is already finalized. Cannot end again.'
        })
        return
      }

      try {

        const closingData = {}

        stock.forEach(
          item => {
            if (item.can_be_front === false) return

            const quantity =
              parseFloat(
                closingStock[
                  item.id
                ]
              )

            closingData[
              item.id
            ] =
              Number.isFinite(
                quantity
              )
                ? Math.max(
                    0,
                    quantity
                  )
                : Math.max(
                    0,
                    parseFloat(item.front_quantity) || 0
                  )
          }
        )

        const closingWarehouseData = {}
        stock.forEach(item => {
          if (item.can_be_front === false) {
            const quantity = parseFloat(formData[`warehouse_close_${item.id}`])
            closingWarehouseData[item.id] =
              Number.isFinite(quantity)
                ? Math.max(0, quantity)
                : Math.max(0, parseFloat(item.warehouse_quantity) || 0)
          }
        })

        const staffCoffeeCount =
          parseInt(
            formData.staffCoffee
          ) || 0

        const staffWaterCount =
          parseInt(
            formData.staffWater
          ) || 0

        const staffSodaCount =
          parseInt(
            formData.staffSoda
          ) || 0

        const staffCannetteCount =
          parseInt(
            formData.staffCannette
          ) || 0

        const staffConsumption = {
          coffee: staffCoffeeCount,
          water: staffWaterCount,
          soda: staffSodaCount,
          cannette: staffCannetteCount
        }

        const metrics = {
          water05Sold:
            parseInt(
              shiftMetrics.water05Sold
            ) || 0,

          water1Sold:
            parseInt(
              shiftMetrics.water1Sold
            ) || 0,

          water15Sold:
            parseInt(
              shiftMetrics.water15Sold
            ) || 0,

          waterBolarSold:
            parseInt(
              shiftMetrics.waterBolarSold
            ) || 0,

          kamia:
            parseInt(
              shiftMetrics.kamia
            ) || 0,

          eau05Used:
            parseInt(
              shiftMetrics.eau05Used
            ) || 0,

          express:
            parseInt(
              shiftMetrics.express
            ) || 0,

          cappuccino:
            parseInt(
              shiftMetrics.cappuccino
            ) || 0,

          americain:
            parseInt(
              shiftMetrics.americain
            ) || 0,

          filter:
            parseInt(
              shiftMetrics.filter
            ) || 0,

          direct:
            parseInt(
              shiftMetrics.direct
            ) || 0,

          chichaTotal:
            parseInt(
              shiftMetrics.chichaTotal
            ) || 0,

          chichaPersonnel:
            parseInt(
              shiftMetrics.chichaPersonnel
            ) || 0,

          sodaSold:
            parseInt(
              shiftMetrics.sodaSold
            ) || 0,

          cannettesSold:
            parseInt(
              shiftMetrics.cannettesSold
            ) || 0
        }

        const response = await api.post(
          `/shifts/${activeShift.id}/end`,
          {
            closingFrontStock:
              closingData,

            closingWarehouseStock: closingWarehouseData,

            cashCollected:
              parseFloat(
                formData.cashCollected
              ) || 0,

            ramiGamesUsed:
              parseInt(
                formData.ramiGamesUsed
              ) || 0,

            ramiPaperClosing:
              ramiPaperClosing === '' ? undefined : Math.max(0, parseInt(ramiPaperClosing, 10) || 0),

            staffConsumption,

            shiftMetrics:
              metrics,

            financialData: {
              expensesAmount: getNumber(financialData.expensesAmount),
              expensesNote: financialData.expensesNote || '',
              staffSalary: getNumber(financialData.staffSalary),
              manqueNote: financialData.manqueNote || ''
            },

            recetteAdjustments,
            correctionActions: getCorrectionActionsPayload() || [],
            chichaKamiaAdjustments: {
              ...water05Classification,
              deduction: { ...water05Deduction }
            },

            workerMessage:
              formData.notes || '',

            actualCashCounted: getNumber(actualCashCounted),
            finalShiftNote: finalShiftNote || ''
          }
        )

        setActiveShift(
          null
        )

        setShowEndForm(
          false
        )

        setShowPreview(false)
        setPreviewData(null)
        setEndShiftStep(0)
        setRecetteAdjustments({})
        setWater05Classification({ chicha: 0, water: 0 })
        setWater05Deduction({ chicha: 0, water: 0 })
        setComparisonEdits({})

        setFormData({})
        setFinancialData({
          expensesAmount: '',
          expensesNote: '',
          staffSalary: '',
          manqueNote: ''
        })
        setActualCashCounted('')
        setFinalShiftNote('')

        setClosingStock({})
        setRamiPaperStock(null)
        setRamiPaperClosing('')
        setRamiPaperAdding('')

        setShiftMetrics(
          emptyMetrics
        )

        setMessage({
          type: 'success',
          text:
            '✅ Shift finalized successfully!'
        })

        await fetchData()

      } catch (error) {

        setMessage({
          type: 'error',
          text:
            error.response?.data?.error ||
            'Failed to end shift'
        })
      }
    }

  /*
  ============================================================
  ADD STOCK
  ============================================================
  */

  const handleAddStock =
    async e => {

      e.preventDefault()

      const allocationsData = []

      Object.keys(
        allocations
      ).forEach(key => {

        if (
          key.startsWith(
            'alloc_'
          )
        ) {

          const itemId =
            key.replace(
              'alloc_',
              ''
            )

          const quantity =
            parseFloat(
              allocations[key]
            ) || 0

          if (
            quantity > 0
          ) {

            allocationsData.push({
              itemId,
              quantity
            })
          }
        }
      })

      if (
        allocationsData.length ===
        0
      ) {

        setMessage({
          type: 'error',
          text:
            'Please add at least one item.'
        })

        return
      }

      try {

        const response =
          await api.post(
            `/shifts/${activeShift.id}/add-stock`,
            {
              allocations:
                allocationsData
            }
          )

        setStock(
          response.data.stock
        )

        setClosingStock(prev => {
          const next = { ...prev }
          ;(response.data.stock || []).forEach(item => {
            if (next[item.id] === undefined || next[item.id] === '') {
              next[item.id] = parseFloat(item.front_quantity) || 0
            } else {
              const previousFront = parseFloat(stock.find(s => s.id === item.id)?.front_quantity) || 0
              const newFront = parseFloat(item.front_quantity) || 0
              const delta = newFront - previousFront
              if (delta > 0) next[item.id] = (parseFloat(next[item.id]) || 0) + delta
            }
          })
          return next
        })

        setAllocations({})

        setShowAddStockForm(
          false
        )

        setShowPreview(false)
        setPreviewData(null)

        setMessage({
          type: 'success',
          text:
            'Stock added to shift. Please preview again to see updated details.'
        })

        await fetchData()

      } catch (error) {

        setMessage({
          type: 'error',
          text:
            error.response?.data?.error ||
            'Failed to add stock'
        })
      }
    }

  /*
  ============================================================
  INPUT HELPERS
  ============================================================
  */

  const updateMetric =
    (key, value) => {

      if (showPreview) {
        setShowPreview(false)
        setPreviewData(null)
      }

      setShiftMetrics({
        ...shiftMetrics,
        [key]:
          value
      })
    }

  const updateClosingStock =
    (itemId, value) => {

      if (showPreview) {
        setShowPreview(false)
        setPreviewData(null)
      }

      setClosingStock({
        ...closingStock,
        [itemId]: value
      })
    }

  const getAdjustmentForProduct = (key, sold, consumed, price) => {
    const diff = Number(consumed || 0) - Number(sold || 0)
    const amount = Math.abs(diff) * Number(price || 0)
    return {
      key,
      diff,
      amount,
      signedAmount: diff > 0 ? amount : diff < 0 ? -amount : 0,
      direction: diff > 0 ? 'add_to_cash' : diff < 0 ? 'remove_from_cash' : 'none'
    }
  }

  const getCorrectionActionsPayload = () => {
    const actions = Object.values(recetteAdjustments).map(action => {
      let direction = 'none'
      if (action.difference > 0) {
        direction = 'add_to_cash'
      } else if (action.difference < 0) {
        direction = 'remove_from_cash'
      }
      
      return {
        ...action,
        direction: direction,
        accepted: action.accepted !== false
      }
    })
    return Array.isArray(actions) ? actions : []
  }

  // NEW: Update water05 deduction when sold > consumed
  const updateWater05Deduction = (type, value, row) => {
    const maxShortage = Math.max(
      0,
      Number(row.sold || 0) - Number(row.effectiveConsumed || 0)
    )

    const nextValue = Math.max(
      0,
      Math.min(maxShortage, parseInt(value, 10) || 0)
    )

    setWater05Deduction(prev => {
      const next = {
        ...prev,
        [type]: nextValue
      }

      const total = Number(next.chicha || 0) + Number(next.water || 0)
      if (total > maxShortage) {
        if (type === 'chicha') {
          next.water = Math.max(0, maxShortage - next.chicha)
        } else {
          next.chicha = Math.max(0, maxShortage - next.water)
        }
      }

      const chichaQty = Number(next.chicha || 0)
      const waterQty = Number(next.water || 0)
      const deductedQty = chichaQty + waterQty

      setRecetteAdjustments(prevAdjustments => {
        const nextAdjustments = { ...prevAdjustments }

        if (deductedQty > 0) {
          const remaining = Math.max(0, maxShortage - deductedQty)
          const currentChichaPrice = getCurrentChichaPrice()
          const amount =
            chichaQty * currentChichaPrice +
            waterQty * Number(row.price || 0) +
            remaining * Number(row.price || 0)

          nextAdjustments.water05 = {
            key: 'water05',
            label: 'EAU 0.5 / Chicha (Déduction)',
            sold: Number(row.sold || 0),
            consumed: Number(row.effectiveConsumed || 0),
            price: Number(row.price || 0),
            amount: amount,
            difference: -maxShortage,
            quantity: deductedQty + remaining,
            direction: 'remove_from_cash',
            accepted: true,
            deduction: {
              chicha: chichaQty,
              water05: waterQty,
              remainingWater05: remaining
            }
          }
        } else if (nextAdjustments.water05?.deduction) {
          delete nextAdjustments.water05
        }

        return nextAdjustments
      })

      return next
    })
  }

  const updateWater05Classification = (type, value, row) => {
    const maxExcess = Math.max(
      0,
      Number(row.effectiveConsumed || 0) - Number(row.sold || 0)
    )

    const nextValue = Math.max(
      0,
      Math.min(maxExcess, parseInt(value, 10) || 0)
    )

    setWater05Classification(prev => {
      const next = {
        ...prev,
        [type]: nextValue
      }

      const total = Number(next.chicha || 0) + Number(next.water || 0)
      if (total > maxExcess) {
        if (type === 'chicha') {
          next.water = Math.max(0, maxExcess - next.chicha)
        } else {
          next.chicha = Math.max(0, maxExcess - next.water)
        }
      }

      const chichaQty = Number(next.chicha || 0)
      const waterQty = Number(next.water || 0)
      const classifiedQty = chichaQty + waterQty

      setRecetteAdjustments(prevAdjustments => {
        const nextAdjustments = { ...prevAdjustments }

        if (classifiedQty > 0) {
          const remaining =
            Math.max(0, maxExcess - classifiedQty)

          const currentChichaPrice = getCurrentChichaPrice()
          const amount =
            chichaQty * currentChichaPrice +
            waterQty * Number(row.price || 0) +
            remaining * Number(row.price || 0)

          nextAdjustments.water05 = {
            key: 'water05',
            label: 'EAU 0.5 / Chicha',
            sold: Number(row.sold || 0),
            consumed: Number(row.effectiveConsumed || 0),
            price: Number(row.price || 0),
            amount,
            difference: maxExcess,
            quantity: classifiedQty + remaining,
            direction: 'add_to_cash',
            accepted: true,
            classification: {
              chicha: chichaQty,
              water05: waterQty,
              remainingWater05: remaining
            }
          }
        } else if (nextAdjustments.water05?.classification) {
          delete nextAdjustments.water05
        }

        return nextAdjustments
      })

      return next
    })
  }

  const toggleRecetteAdjustment = (row, checked) => {
    setRecetteAdjustments(prev => {
      const next = { ...prev }

      if (checked) {
        const diff = Number(row.effectiveConsumed || 0) - Number(row.sold || 0)
        const amount = Math.abs(diff) * Number(row.price || 0)

        let direction = 'none'
        if (diff > 0) {
          direction = 'add_to_cash'
        } else if (diff < 0) {
          direction = 'remove_from_cash'
        } else {
          direction = 'none'
        }

        let classification = null
        let deduction = null
        let finalAmount = amount

        if (row.key === 'water05') {
          if (diff > 0) {
            // Excess consumed - classification
            const chichaQty = Number(water05Classification.chicha || 0)
            const waterQty = Number(water05Classification.water || 0)
            const excess = Math.max(0, diff)
            const remaining = Math.max(0, excess - chichaQty - waterQty)
            const currentChichaPrice = getCurrentChichaPrice()
            finalAmount =
              chichaQty * currentChichaPrice +
              waterQty * Number(row.price || 0) +
              remaining * Number(row.price || 0)
            
            classification = {
              chicha: chichaQty,
              water05: waterQty,
              remainingWater05: remaining
            }
          } else if (diff < 0) {
            // Shortage - deduction
            const chichaQty = Number(water05Deduction.chicha || 0)
            const waterQty = Number(water05Deduction.water || 0)
            const shortage = Math.abs(diff)
            const remaining = Math.max(0, shortage - chichaQty - waterQty)
            const currentChichaPrice = getCurrentChichaPrice()
            finalAmount =
              chichaQty * currentChichaPrice +
              waterQty * Number(row.price || 0) +
              remaining * Number(row.price || 0)
            
            deduction = {
              chicha: chichaQty,
              water05: waterQty,
              remainingWater05: remaining
            }
          }
        }

        next[row.key] = {
          key: row.key,
          label: row.key === 'water05' && diff !== 0
            ? diff > 0 ? 'EAU 0.5 / Chicha (Excédent)' : 'EAU 0.5 / Chicha (Déduction)'
            : row.label,
          sold: row.sold,
          consumed: row.effectiveConsumed,
          price: row.price,
          amount: finalAmount,
          difference: diff,
          direction: direction,
          accepted: true,
          ...(classification ? { classification } : {}),
          ...(deduction ? { deduction } : {})
        }
      } else {
        delete next[row.key]
      }

      return next
    })
  }

  const updateComparisonConsumed = (key, value) => {
    setComparisonEdits(prev => ({ ...prev, [key]: value }))

    if (key === 'water05') {
      setWater05Classification({
        chicha: 0,
        water: 0
      })
      setWater05Deduction({
        chicha: 0,
        water: 0
      })
    }

    setRecetteAdjustments(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const handleAddRamiPaper = async () => {
    if (!activeShift || !ramiPaperAdding) return
    const quantity = Math.trunc(Number(ramiPaperAdding))
    if (!Number.isFinite(quantity) || quantity <= 0) return
    try {
      setRamiPaperLoading(true)
      const response = await api.post('/shifts/rami-paper/add', {
        shiftId: activeShift.id,
        quantity
      })
      setRamiPaperStock(response.data)
      setRamiPaperAdding('')
      setMessage({ type: 'success', text: `✅ ${quantity} papier(s) Rami ajouté(s).` })
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || 'Impossible d\'ajouter le papier Rami.' })
    } finally {
      setRamiPaperLoading(false)
    }
  }

  const handleSaveRamiPaperClosing = async () => {
    if (!activeShift || ramiPaperClosing === '') return
    try {
      setRamiPaperLoading(true)
      const response = await api.post('/shifts/rami-paper/close', {
        shiftId: activeShift.id,
        closingQuantity: Math.trunc(Number(ramiPaperClosing))
      })
      setRamiPaperStock(response.data.stock)
      setMessage({ type: 'success', text: `💾 Papier Rami enregistré : ${response.data.used} utilisé(s), ${response.data.closing} restant(s).` })
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || 'Impossible d\'enregistrer le papier Rami.' })
    } finally {
      setRamiPaperLoading(false)
    }
  }

  /*
  ============================================================
  RENDER FUNCTIONS
  ============================================================
  */

  const renderStartShiftForm = () => {
  if (stock.length === 0) {
    return (
      <div className="endshift-shell startshift-shell">
        <div className="wizard-topbar">
          <div>
            <span className="phase-kicker">START SHIFT</span>
            <h2>🚀 Chargement du stock...</h2>
            <p>Veuillez patienter pendant le chargement des données.</p>
          </div>
        </div>
        <div className="loading-screen" style={{ minHeight: '200px' }}>
          Chargement du stock...
        </div>
      </div>
    )
  }

  const totalFront = stock.reduce(
    (sum, item) =>
      sum + (parseFloat(item.front_quantity) || 0),
    0
  )

  const totalAdded = stock.reduce(
    (sum, item) =>
      sum +
      (parseFloat(
        formData[`stock_${item.id}`]
      ) || 0),
    0
  )

  return (
    <div className="endshift-shell startshift-shell">

      <div className="wizard-topbar">

        <div>
          <span className="phase-kicker">
            START SHIFT
          </span>

          <h2>
            🚀 Démarrage du shift
          </h2>

          <p>
            Vérifiez le stock actuellement disponible au café
            et ajoutez uniquement le stock nécessaire depuis
            le dépôt.
          </p>
        </div>

        <div className="step-pills">
          <span className="active">
            1. Stock initial
          </span>

          <span>
            2. Shift actif
          </span>

          <span>
            3. Clôture
          </span>
        </div>

      </div>

      <div className="formula-banner start-info-banner">

        <strong>
          💡 Comment ça fonctionne
        </strong>

        <span>
          Le stock restant du shift précédent est conservé
          automatiquement. Vous ajoutez seulement le nouveau
          stock pris depuis le dépôt.
        </span>

      </div>

      <div className="wizard-section">

        <div className="section-title">

          <div>

            <span>
              📦 STOCK ACTUEL
            </span>

            <h3>
              Stock disponible au café
            </h3>

            <p>
              Voici le stock actuellement présent avant le
              début du nouveau shift.
            </p>

          </div>

        </div>

        <div className="closing-stock-grid">

          {stock.length === 0 ? (

            <div className="empty-state">
              Aucun produit disponible.
            </div>

          ) : (

            stock.map(item => {

              const frontQty =
                parseFloat(
                  item.front_quantity
                ) || 0

              const warehouseQty =
                parseFloat(
                  item.warehouse_quantity
                ) || 0

              return (

                <div
                  className="start-stock-card"
                  key={item.id}
                >

                  <div className="start-stock-card-header">

                    <strong>
                      {item.display_name || item.name}
                    </strong>

                    <span>
                      {item.unit || 'unités'}
                    </span>

                  </div>

                  <div className="start-stock-numbers">

                    <div>

                      <span>
                        ☕ Au café
                      </span>

                      <strong>
                        {frontQty.toFixed(2)}
                      </strong>

                    </div>

                    <div>

                      <span>
                        🏪 Dépôt
                      </span>

                      <strong>
                        {warehouseQty.toFixed(2)}
                      </strong>

                    </div>

                  </div>

                </div>

              )

            })

          )}

        </div>

      </div>

      <div className="wizard-section">
        <div className="section-title">
          <div>
            <span>RAMI PAPER</span>
            <h3>📄 Papier Rami</h3>
            <p>Le papier Rami est géré directement par les travailleurs, sans allocation du dépôt.</p>
          </div>
        </div>
        <div className="wizard-input">
          <label>📄 Quantité présente au début du shift</label>
          <input
            type="number"
            min="0"
            step="1"
            value={formData.ramiPaperOpening ?? ''}
            readOnly
            placeholder="Stock actuel au café"
          />
        </div>
      </div>

      <form
        onSubmit={handleStartShift}
      >

        <div className="wizard-section">

          <div className="section-title">

            <div>

              <span>
                ➕ AJOUT DE STOCK
              </span>

              <h3>
                Ajouter du stock depuis le dépôt
              </h3>

              <p>
                Entrez uniquement la quantité supplémentaire
                que vous voulez prendre depuis le dépôt.
              </p>

            </div>

          </div>

          <div className="start-add-stock-list">

            {stock.filter(item => item.can_be_front !== false).map(item => {

              const warehouseAvailable =
                parseFloat(
                  item.warehouse_quantity
                ) || 0

              const frontCurrent =
                parseFloat(
                  item.front_quantity
                ) || 0

              const addQty =
                parseFloat(
                  formData[
                    `stock_${item.id}`
                  ]
                ) || 0

              const futureFront =
                frontCurrent +
                addQty

              return (

                <div
                  className="start-add-row"
                  key={item.id}
                >

                  <div className="start-product-info">

                    <strong>
                      {item.display_name || item.name}
                    </strong>

                    <small>

                      ☕ Au café :
                      {' '}
                      {frontCurrent.toFixed(2)}
                      {' '}
                      {item.unit}

                      {' · '}

                      🏪 Disponible dépôt :
                      {' '}
                      {warehouseAvailable.toFixed(2)}
                      {' '}
                      {item.unit}

                    </small>

                  </div>

                  <div className="start-add-input">

                    <label>
                      Ajouter
                    </label>

                    <input
                      type="number"

                      step={
                        item.is_fractional
                          ? '0.01'
                          : '1'
                      }

                      min="0"

                      max={
                        warehouseAvailable
                      }

                      value={
                        formData[
                          `stock_${item.id}`
                        ] || ''
                      }

                      placeholder="0"

                      onChange={e => {

                        const rawValue =
                          e.target.value

                        const value =
                          rawValue === ''
                            ? ''
                            : Math.min(
                                Math.max(
                                  0,
                                  parseFloat(
                                    rawValue
                                  ) || 0
                                ),
                                warehouseAvailable
                              )

                        setFormData(
                          prev => ({
                            ...prev,

                            [`stock_${item.id}`]:
                              value
                          })
                        )

                      }}

                    />

                    <span>
                      {item.unit}
                    </span>

                  </div>

                  <div className="start-future-stock">

                    <span>
                      Après ajout
                    </span>

                    <strong>
                      {futureFront.toFixed(2)}
                      {' '}
                      {item.unit}
                    </strong>

                  </div>

                </div>

              )

            })}

          </div>

        </div>

        <div className="wizard-section start-summary-section">

          <div className="section-title">

            <div>

              <span>
                📋 RÉSUMÉ
              </span>

              <h3>
                Résumé avant de démarrer
              </h3>

              <p>
                Vérifiez les quantités avant de commencer
                le shift.
              </p>

            </div>

          </div>

          <div className="start-summary-grid">

            <div className="money-card">

              <span>
                📦 Stock actuel au café
              </span>

              <strong>
                {totalFront.toFixed(2)}
              </strong>

            </div>

            <div className="money-card">

              <span>
                ➕ Nouveau stock ajouté
              </span>

              <strong className="positive-text">
                +{totalAdded.toFixed(2)}
              </strong>

            </div>

            <div className="money-card final">

              <span>
                🚀 Stock total après démarrage
              </span>

              <strong>
                {(totalFront + totalAdded).toFixed(2)}
              </strong>

            </div>

          </div>

          <div className="start-summary-list">

            {stock.map(item => {

              const frontCurrent =
                parseFloat(
                  item.front_quantity
                ) || 0

              const addQty =
                parseFloat(
                  formData[
                    `stock_${item.id}`
                  ]
                ) || 0

              const futureFront =
                frontCurrent +
                addQty

              if (
                frontCurrent === 0 &&
                addQty === 0
              ) {
                return null
              }

              return (

                <div
                  className="mini-summary"
                  key={item.id}
                >

                  <div>

                    <strong>
                      {item.display_name ||
                        item.name}
                    </strong>

                    <span>

                      Actuel:
                      {' '}
                      {frontCurrent.toFixed(2)}

                      {' → '}

                      Après:
                      {' '}
                      {futureFront.toFixed(2)}

                      {' '}

                      {item.unit}

                    </span>

                  </div>

                  {addQty > 0 && (

                    <b className="positive-text">

                      +{addQty.toFixed(2)}

                    </b>

                  )}

                </div>

              )

            })}

          </div>

        </div>

        <div className="wizard-nav split">

          <button
            type="button"
            className="btn btn-secondary btn-large"

            onClick={() => {

              setShowStartForm(false)

              setFormData({})

            }}
          >

            ← Annuler

          </button>

          <button
            type="submit"
            className="btn btn-success btn-large"
          >

            🚀 Démarrer le shift

          </button>

        </div>

      </form>

    </div>
  )
}

  const renderAddStockForm =
    () => (

      <div className="form-card">

        <h3>
          ➕ Add Stock Mid-Shift
        </h3>

        <form
          onSubmit={
            handleAddStock
          }
        >

          {stock.map(item => {

            const available =
              parseFloat(
                item.warehouse_quantity
              ) || 0

            return (

              <div
                key={item.id}
                className="form-row"
              >

                <label>

                  {item.display_name}

                  <span className="available-hint">

                    {' '}
                    (
                    Available:
                    {' '}
                    {available}
                    {' '}
                    {item.unit}
                    )

                  </span>

                </label>

                <input
                  type="number"
                  step={
                    item.is_fractional
                      ? '0.01'
                      : '1'
                  }
                  min="0"
                  max={available}
                  value={
                    allocations[
                      `alloc_${item.id}`
                    ] || ''
                  }
                  onChange={e => {

                    const value =
                      parseFloat(
                        e.target.value
                      ) || 0

                    setAllocations({
                      ...allocations,

                      [`alloc_${item.id}`]:
                        Math.min(
                          value,
                          available
                        )
                    })
                  }}
                  placeholder="0"
                />

              </div>
            )
          })}

          <div className="form-actions">

            <button
              type="submit"
              className="btn btn-primary"
            >
              Add Stock
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={() =>
                setShowAddStockForm(
                  false
                )
              }
            >
              Cancel
            </button>

          </div>

        </form>

      </div>
    )

  /*
  ============================================================
  PREVIEW DETAILS - FIXED WITH DEDUCTION SUPPORT
  ============================================================
  */

  const renderPreviewDetails = () => {
    if (!previewData) return null

    const metrics = previewData.shift_metrics || previewData.shiftMetrics || shiftMetrics || {}
    const recipe = previewData.recette_breakdown || previewData.recetteBreakdown || {}
    const stockConsumption = previewData.stock_consumption || previewData.stockConsumption || []
    let corrections = previewData.correction_actions || previewData.correctionActions || []

    if (!Array.isArray(corrections)) {
      corrections = []
    }

    const n = value => Number(value || 0)
    const fixed = value => Number(value || 0).toFixed(2)
    const findPrice = keys => {
      const item = stock.find(item => {
        const name = `${item.display_name || ''} ${item.name || ''}`.toLowerCase()
        return keys.some(key => name.includes(key))
      })
      return n(item?.price)
    }

    const cash = n(recipe.cash ?? formData.cashCollected ?? 0)
    const ramiGamesUsed = n(recipe.ramiQuantity ?? formData.ramiGamesUsed ?? 0)
    const ramiPrice = n(recipe.ramiPrice ?? 1.5)
    const rami = ramiGamesUsed * ramiPrice
    
    const coffeePrice = n(stock.find(item => {
      const name = `${item.display_name || ''} ${item.name || ''}`.toLowerCase()
      return name.includes('coffee') || name.includes('cafe')
    })?.staff_price || 0)
    
    const waterPrice = n(stock.find(item => {
      const name = `${item.display_name || ''} ${item.name || ''}`.toLowerCase()
      return name.includes('water') || name.includes('eau')
    })?.staff_price || 0)
    
    const sodaPrice = n(stock.find(item => {
      const name = `${item.display_name || ''} ${item.name || ''}`.toLowerCase()
      return name.includes('soda') || name.includes('gazeuse')
    })?.staff_price || 0)
    
    const cannettePrice = n(stock.find(item => {
      const name = `${item.display_name || ''} ${item.name || ''}`.toLowerCase()
      return name.includes('cannette') || name.includes('canette')
    })?.staff_price || 0)
    
    const staffCoffeeQty = n(recipe.staffCoffeeQuantity ?? formData.staffCoffee ?? 0)
    const staffWaterQty = n(recipe.staffWaterQuantity ?? formData.staffWater ?? 0)
    const staffSodaQty = n(recipe.staffSodaQuantity ?? formData.staffSoda ?? 0)
    const staffCannetteQty = n(recipe.staffCannetteQuantity ?? formData.staffCannette ?? 0)
    
    const staffCoffee = staffCoffeeQty * coffeePrice
    const staffWater = staffWaterQty * waterPrice
    const staffSoda = staffSodaQty * sodaPrice
    const staffCannette = staffCannetteQty * cannettePrice
    const staffTotal = staffCoffee + staffWater + staffSoda + staffCannette

    const expenses = n(financialData.expensesAmount || recipe.expenses || 0)
    const salary = n(financialData.staffSalary || recipe.staffSalary || 0)

    const adjustmentTotal = Object.values(recetteAdjustments)
      .reduce((sum, item) => {
        const amount = n(item.amount)
        if (item.direction === 'remove_from_cash' || item.direction === 'remove') {
          return sum - amount
        }
        return sum + amount
      }, 0)

    const calculatedFinal = cash + rami - staffTotal - expenses - salary + adjustmentTotal

    const actualCash = n(actualCashCounted)
    const expectedCash = cash + rami - staffTotal - expenses - salary + adjustmentTotal
    const cashGap = actualCash - expectedCash

    const kamia = n(metrics.kamia)
    const chichaTotal = n(metrics.chichaTotal)
    const chichaPersonnel = n(metrics.chichaPersonnel)
    const normalChicha = n(metrics.normalChicha) || (chichaTotal - chichaPersonnel)

    const water05Consumed = n(metrics.water05Consumed)
    const water05Sold = n(metrics.water05Sold)
    const kamiaValue = n(metrics.kamia)
    const totalWater05Sold = water05Sold + kamiaValue

    const water1Consumed = n(metrics.water1Consumed)
    const water15Consumed = n(metrics.water15Consumed)
    const waterBolarConsumed = n(metrics.waterBolarConsumed)

    const baseRows = [
      { key: 'water05', label: 'EAU 0.5 + Kamia', sold: totalWater05Sold, consumed: water05Consumed, price: findPrice(['0.5', '05', 'water05']) },
      { key: 'water1', label: 'EAU 1L', sold: n(metrics.water1Sold), consumed: water1Consumed, price: findPrice(['eau 1', 'eau1', '1l', '1 l', 'water1']) },
      { key: 'water15', label: 'EAU 1.5L', sold: n(metrics.water15Sold), consumed: water15Consumed, price: findPrice(['1.5', 'water15', 'eau15']) },
      { key: 'waterBolar', label: 'EAU BOLAR', sold: n(metrics.waterBolarSold), consumed: waterBolarConsumed, price: findPrice(['bolar']) },
      { key: 'soda', label: 'Gazeuses', sold: n(metrics.sodaSold), consumed: n(metrics.sodaConsumed), price: findPrice(['gazeuse', 'soda']) },
      { key: 'cannettes', label: 'Cannettes', sold: n(metrics.cannettesSold), consumed: n(metrics.cannettesConsumed), price: findPrice(['cannette', 'canette']) }
    ]

    const rows = baseRows.map(row => ({
      ...row,
      effectiveConsumed: comparisonEdits[row.key] === undefined || comparisonEdits[row.key] === ''
        ? row.consumed
        : n(comparisonEdits[row.key])
    }))

    const water05Row = rows.find(row => row.key === 'water05')

    const status = row => {
      const diff = row.sold - row.effectiveConsumed
      if (Math.abs(diff) < 0.001) return <span className="status status-ok">✅ OK</span>
      if (diff > 0) return <span className="status status-warn">⚠️ Plus vendu que consommé</span>
      return <span className="status status-danger">⚠️ Plus consommé que vendu</span>
    }

    const getDifferenceClass = diff => {
      if (Math.abs(diff) < 0.001) return 'diff-ok'
      if (diff > 0) return 'diff-warn'
      return 'diff-danger'
    }

    const comparisonTable = groupRows => (
      <div className="comparison-table-wrap">
        <table className="comparison-table">
          <thead><tr><th>Produit</th><th>Vendu (Ticket)</th><th>Consommé (Stock)</th><th>Différence</th><th>Status</th></tr></thead>
          <tbody>
            {groupRows.map(row => {
              const diff = row.sold - row.effectiveConsumed
              return <tr key={row.key}>
                <td><strong>{row.label}</strong></td>
                <td>{row.sold.toFixed(2)}</td>
                <td>{row.effectiveConsumed.toFixed(2)}</td>
                <td className={getDifferenceClass(diff)}>{diff > 0 ? '+' : ''}{diff.toFixed(2)}</td>
                <td>{status(row)}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    )

    const acceptedCorrections = Array.isArray(corrections)
      ? corrections.filter(action => action && action.accepted !== false)
      : []

    const correctionNet = acceptedCorrections.reduce((sum, action) => {
      const amount = n(action.amount)
      if (action.direction === 'remove_from_cash') {
        return sum - amount
      }
      return sum + amount
    }, 0)

    const kamiaEqualsChicha = Math.abs(kamia - chichaTotal) < 0.1

    return (
      <div className="endshift-wizard-results">
        {endShiftStep === 1 && (
          <>
            <div className="phase-heading">
              <div><span className="phase-kicker">PHASE 1 · CONTRÔLE</span><h2>💰 Recette & contrôle du shift</h2><p>Vérifiez les chiffres avant toute correction.</p></div>
              <button type="button" className="btn btn-secondary" onClick={() => { setEndShiftStep(0); setShowPreview(false) }}>← Modifier les chiffres</button>
            </div>

            <div className="recette-grid">
              {[
                ['💵 Cash', cash, 'positive'],
                ['🎮 Rami Games', rami, 'positive'],
                ['☕ Staff Coffee', -staffCoffee, 'negative'],
                ['💧 Staff Water', -staffWater, 'negative'],
                ['🥤 Staff Gazeuse', -staffSoda, 'negative'],
                ['🥫 Staff Cannette', -staffCannette, 'negative'],
                ['💸 Dépenses', -expenses, 'negative'],
                ['👤 Salaire staff', -salary, 'negative'],
                ['🔧 Corrections', adjustmentTotal, adjustmentTotal >= 0 ? 'positive' : 'negative']
              ].map(([label, value, type]) => <div className={`money-card ${type}`} key={label}><span>{label}</span><strong>{value >= 0 ? '+' : ''}{value.toFixed(2)} DT</strong></div>)}
              <div className="money-card final"><span>✨ Recette provisoire</span><strong>{calculatedFinal.toFixed(2)} DT</strong></div>
            </div>

            <section className="wizard-section">
              <div className="section-title">
                <div>
                  <span>CONTRÔLE DES VENTES</span>
                  <h3>📊 Comparaison: Vendu vs Consommé</h3>
                  <p>Vérifiez que Kamia = Chicha et que EAU 0.5 + Kamia = Chicha Total</p>
                </div>
              </div>
              
              <div className={`kamia-check ${kamiaEqualsChicha ? 'same' : 'different'}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                  <span>
                    🫖 <strong>Kamia:</strong> {kamia}
                  </span>
                  <span>
                    🌿 <strong>Total Chicha:</strong> {chichaTotal}
                  </span>
                  <span>
                    📊 <strong>Différence:</strong> {fixed(chichaTotal - kamia)}
                  </span>
                  <b>
                    {kamiaEqualsChicha ? '✅ Same' : '❌ Different - Correction nécessaire'}
                  </b>
                </div>
              </div>

              <h4 style={{ marginTop: '20px' }}>💧 Eau - Détail par produit</h4>
              {comparisonTable(rows.filter(r => r.key.startsWith('water')))}
              
              <h4>🥤 Gazeuses</h4>
              {comparisonTable(rows.filter(r => r.key === 'soda'))}
              
              <h4>🥫 Cannettes</h4>
              {comparisonTable(rows.filter(r => r.key === 'cannettes'))}
            </section>

            <div className="wizard-nav">
              <button type="button" className="btn btn-primary btn-large" onClick={() => setEndShiftStep(2)}>Next step → Corriger la recette</button>
            </div>
          </>
        )}

        {endShiftStep === 2 && (
          <>
            <div className="phase-heading"><div><span className="phase-kicker">PHASE 2 · CORRECTION</span><h2>🔧 Fix the recette automatically</h2><p>Cochez uniquement les corrections que vous acceptez. Vous pouvez modifier le nombre consommé avant de valider.</p></div></div>
            <div className="fix-summary"><span>Corrections acceptées</span><strong>{Object.keys(recetteAdjustments).length}</strong><span>Impact recette</span><strong className={adjustmentTotal >= 0 ? 'positive-text' : 'negative-text'}>{adjustmentTotal >= 0 ? '+' : ''}{adjustmentTotal.toFixed(2)} DT</strong></div>
            
            <div className="fix-list">
              {rows.map(row => {
                const adjustment = getAdjustmentForProduct(row.key, row.sold, row.effectiveConsumed, row.price)
                const hasIssue = adjustment.direction !== 'none'
                const diff = row.sold - row.effectiveConsumed
                const hasExcessSold = diff > 0
                
                const shouldShowIssue = hasIssue || hasExcessSold
                
                let actionDisplay = null
                if (!hasIssue && !hasExcessSold) {
                  actionDisplay = <span className="status status-ok">✅ Aucun changement</span>
                } else if (hasIssue && adjustment.direction === 'add_to_cash') {
                  actionDisplay = <><b className="positive-text">+ Ajouter {adjustment.amount.toFixed(2)} DT</b><small>Consommé &gt; Vendu</small></>
                } else if (hasIssue && adjustment.direction === 'remove_from_cash') {
                  actionDisplay = <><b className="negative-text">− Retirer {adjustment.amount.toFixed(2)} DT</b><small>Vendu &gt; Consommé</small></>
                } else if (hasExcessSold) {
                  actionDisplay = <><b className="negative-text">− Retirer {(diff * row.price).toFixed(2)} DT</b><small>Vendu &gt; Consommé (manuel)</small></>
                } else {
                  actionDisplay = <span className="status status-ok">✅ OK</span>
                }
                
                return <div className={`fix-row ${shouldShowIssue ? 'has-issue' : 'ok'}`} key={row.key}>
                  <label className="fix-check">
                    <input type="checkbox" checked={!!recetteAdjustments[row.key]} onChange={e => toggleRecetteAdjustment(row, e.target.checked)} />
                    <span></span>
                  </label>
                  <div className="fix-product">
                    <strong>{row.label}</strong>
                    <small>Vendu: {row.sold} · Prix: {row.price.toFixed(2)} DT</small>
                    {hasExcessSold && (
                      <small style={{ color: '#e67e22', display: 'block' }}>
                        ⚠️ Vendus: {diff} de plus que consommé
                      </small>
                    )}
                    {row.key === 'water05' && !hasExcessSold && hasIssue && (
                      <small style={{ color: '#27ae60', display: 'block' }}>
                        📦 Consommés: {Math.abs(diff)} de plus que vendu
                      </small>
                    )}
                  </div>
                  <div className="fix-edit">
                    <label>Consommé / Manque</label>
                    <input type="number" min="0" step="0.01" value={comparisonEdits[row.key] ?? row.consumed} onChange={e => updateComparisonConsumed(row.key, e.target.value)} />
                  </div>
                  <div className="fix-action">
                    {actionDisplay}
                  </div>
                </div>
              })}
            </div>

            {/* EAU 0.5 -> CHICHA / EAU CLASSIFICATION - Only shown when consumed > sold */}
            {(() => {
              const water05Row = rows.find(row => row.key === 'water05')
              if (!water05Row) return null

              const excess = Math.max(
                0,
                Number(water05Row.effectiveConsumed || 0) -
                Number(water05Row.sold || 0)
              )

              // Show classification when consumed > sold (excess)
              if (excess > 0) {
                const chichaQty = Number(water05Classification.chicha || 0)
                const waterQty = Number(water05Classification.water || 0)
                const classifiedQty = chichaQty + waterQty
                const remainingQty = Math.max(0, excess - classifiedQty)
                
                const priceToUse = Number(recipe.chichaPrice) > 0 ? Number(recipe.chichaPrice) : getCurrentChichaPrice()
                
                const classifiedValue =
                  chichaQty * priceToUse +
                  waterQty * Number(water05Row.price || 0) +
                  remainingQty * Number(water05Row.price || 0)

                return (
                  <div
                    className="wizard-section chicha-kamia-section"
                    style={{
                      marginTop: '20px',
                      borderTop: '2px solid #e0e0e0',
                      paddingTop: '20px'
                    }}
                  >
                    <div className="section-title">
                      <div>
                        <span>🫖 CHICHA / EAU 0.5 - CLASSIFICATION</span>
                        <h3>🌿 Classifier l'excédent d'EAU 0.5</h3>
                        <p>
                          L'EAU 0.5 consommée est supérieure aux ventes.
                          Choisissez combien de bouteilles correspondent à la Chicha
                          et combien restent de l'EAU 0.5.
                        </p>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: '12px',
                        marginBottom: '15px'
                      }}
                    >
                      <div className="money-card">
                        <span>🧾 EAU 0.5 vendu</span>
                        <strong>{Number(water05Row.sold || 0)}</strong>
                      </div>
                      <div className="money-card">
                        <span>📦 EAU 0.5 consommé</span>
                        <strong>{Number(water05Row.effectiveConsumed || 0)}</strong>
                      </div>
                      <div className={`money-card ${excess > 0 ? 'negative' : 'positive'}`}>
                        <span>📊 Excédent à classer</span>
                        <strong>{excess}</strong>
                      </div>
                      <div className="money-card">
                        <span>💰 Impact correction</span>
                        <strong>{classifiedValue.toFixed(2)} DT</strong>
                      </div>
                    </div>

                    <div
                      style={{
                        padding: '15px',
                        background: '#fff3cd',
                        borderRadius: '8px',
                        border: '1px solid #ffc107',
                        marginBottom: '15px'
                      }}
                    >
                      <strong>⚠️ Il y a {excess} bouteille(s) consommée(s) de plus que vendue(s).</strong>
                      <div style={{ marginTop: '6px' }}>
                        Le worker peut répartir cet écart entre :
                        <strong> Chicha = {priceToUse.toFixed(2)} DT</strong> et
                        <strong> EAU 0.5 = {Number(water05Row.price || 0).toFixed(2)} DT</strong>.
                      </div>
                      <div style={{ marginTop: '6px' }}>
                        Classé : <strong>{classifiedQty}</strong> / {excess}
                        {' · '}
                        Reste EAU 0.5 : <strong>{remainingQty}</strong>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '15px'
                      }}
                    >
                      <div className="wizard-input">
                        <label>🌿 Nombre à classer comme Chicha ({priceToUse.toFixed(2)} DT)</label>
                        <input
                          type="number"
                          min="0"
                          max={excess}
                          step="1"
                          value={water05Classification.chicha}
                          onChange={e =>
                            updateWater05Classification(
                              'chicha',
                              e.target.value,
                              water05Row
                            )
                          }
                        />
                        <small>
                          {chichaQty} × {priceToUse.toFixed(2)} DT = {(chichaQty * priceToUse).toFixed(2)} DT
                        </small>
                      </div>

                      <div className="wizard-input">
                        <label>💧 Nombre à classer comme EAU 0.5 ({Number(water05Row.price || 0).toFixed(2)} DT)</label>
                        <input
                          type="number"
                          min="0"
                          max={excess}
                          step="1"
                          value={water05Classification.water}
                          onChange={e =>
                            updateWater05Classification(
                              'water',
                              e.target.value,
                              water05Row
                            )
                          }
                        />
                        <small>
                          {waterQty} × {Number(water05Row.price || 0).toFixed(2)} DT = {(waterQty * Number(water05Row.price || 0)).toFixed(2)} DT
                        </small>
                      </div>
                    </div>
                  </div>
                )
              }

              // NEW: Show deduction when sold > consumed (shortage)
              const shortage = Math.max(
                0,
                Number(water05Row.sold || 0) -
                Number(water05Row.effectiveConsumed || 0)
              )

              if (shortage > 0) {
                const chichaQty = Number(water05Deduction.chicha || 0)
                const waterQty = Number(water05Deduction.water || 0)
                const deductedQty = chichaQty + waterQty
                const remainingQty = Math.max(0, shortage - deductedQty)
                
                const priceToUse = Number(recipe.chichaPrice) > 0 ? Number(recipe.chichaPrice) : getCurrentChichaPrice()
                
                const deductedValue =
                  chichaQty * priceToUse +
                  waterQty * Number(water05Row.price || 0) +
                  remainingQty * Number(water05Row.price || 0)

                return (
                  <div
                    className="wizard-section chicha-kamia-section"
                    style={{
                      marginTop: '20px',
                      borderTop: '2px solid #e0e0e0',
                      paddingTop: '20px'
                    }}
                  >
                    <div className="section-title">
                      <div>
                        <span>🫖 CHICHA / EAU 0.5 - DÉDUCTION</span>
                        <h3>📉 Choisir quoi déduire</h3>
                        <p>
                          L'EAU 0.5 vendue est supérieure à la consommation.
                          Choisissez combien de bouteilles à déduire de la Chicha
                          et combien de l'EAU 0.5.
                        </p>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: '12px',
                        marginBottom: '15px'
                      }}
                    >
                      <div className="money-card">
                        <span>🧾 EAU 0.5 vendu</span>
                        <strong>{Number(water05Row.sold || 0)}</strong>
                      </div>
                      <div className="money-card">
                        <span>📦 EAU 0.5 consommé</span>
                        <strong>{Number(water05Row.effectiveConsumed || 0)}</strong>
                      </div>
                      <div className={`money-card ${shortage > 0 ? 'negative' : 'positive'}`}>
                        <span>📊 Manque à déduire</span>
                        <strong>{shortage}</strong>
                      </div>
                      <div className="money-card">
                        <span>💰 Impact déduction</span>
                        <strong>{deductedValue.toFixed(2)} DT</strong>
                      </div>
                    </div>

                    <div
                      style={{
                        padding: '15px',
                        background: '#ffebee',
                        borderRadius: '8px',
                        border: '1px solid #ef5350',
                        marginBottom: '15px'
                      }}
                    >
                      <strong>⚠️ Il y a {shortage} bouteille(s) vendue(s) de plus que consommée(s).</strong>
                      <div style={{ marginTop: '6px' }}>
                        Le worker peut répartir cette déduction entre :
                        <strong> Chicha = {priceToUse.toFixed(2)} DT</strong> et
                        <strong> EAU 0.5 = {Number(water05Row.price || 0).toFixed(2)} DT</strong>.
                      </div>
                      <div style={{ marginTop: '6px' }}>
                        Déduit : <strong>{deductedQty}</strong> / {shortage}
                        {' · '}
                        Reste à déduire : <strong>{remainingQty}</strong>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: '15px'
                      }}
                    >
                      <div className="wizard-input">
                        <label>🌿 Nombre à déduire de la Chicha ({priceToUse.toFixed(2)} DT)</label>
                        <input
                          type="number"
                          min="0"
                          max={shortage}
                          step="1"
                          value={water05Deduction.chicha}
                          onChange={e =>
                            updateWater05Deduction(
                              'chicha',
                              e.target.value,
                              water05Row
                            )
                          }
                        />
                        <small>
                          {chichaQty} × {priceToUse.toFixed(2)} DT = {(chichaQty * priceToUse).toFixed(2)} DT
                        </small>
                      </div>

                      <div className="wizard-input">
                        <label>💧 Nombre à déduire de l'EAU 0.5 ({Number(water05Row.price || 0).toFixed(2)} DT)</label>
                        <input
                          type="number"
                          min="0"
                          max={shortage}
                          step="1"
                          value={water05Deduction.water}
                          onChange={e =>
                            updateWater05Deduction(
                              'water',
                              e.target.value,
                              water05Row
                            )
                          }
                        />
                        <small>
                          {waterQty} × {Number(water05Row.price || 0).toFixed(2)} DT = {(waterQty * Number(water05Row.price || 0)).toFixed(2)} DT
                        </small>
                      </div>
                    </div>
                  </div>
                )
              }

              return null
            })()}

            <div className="wizard-nav split"><button type="button" className="btn btn-secondary" onClick={() => setEndShiftStep(1)}>← Retour</button><button type="button" className="btn btn-primary btn-large" onClick={handleEnterRecording}>💾 Enregistrer → Comptage de caisse</button></div>
          </>
        )}

        {endShiftStep === 3 && (
          <>
            <div className="phase-heading">
              <div>
                <span className="phase-kicker">PHASE 3 · ENREGISTREMENT</span>
                <h2>⏳ Enregistrement du comptage</h2>
                <p>Le shift est enregistré et reste ouvert pendant que vous comptez l'argent. Vous pouvez fermer l'application ou perdre la connexion : le shift reprendra ici.</p>
              </div>
            </div>
            
            <div className="final-recipe-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px', marginBottom: '20px' }}>
              <div className="money-card" style={{ gridColumn: 'span 3' }}>
                <span>💰 Recette attendue en caisse</span>
                <strong style={{ fontSize: '2rem' }}>{expectedCash.toFixed(2)} DT</strong>
              </div>
              <div className="money-card positive">
                <span>💵 Cash</span>
                <strong>+{cash.toFixed(2)} DT</strong>
              </div>
              <div className="money-card positive">
                <span>🎮 Rami Games ({ramiGamesUsed} × 1.5)</span>
                <strong>+{rami.toFixed(2)} DT</strong>
              </div>
              <div className="money-card negative">
                <span>👥 Staff (Café, Eau, Gazeuse, Cannette)</span>
                <strong>-{staffTotal.toFixed(2)} DT</strong>
              </div>
              <div className="money-card negative">
                <span>💸 Dépenses</span>
                <strong>-{expenses.toFixed(2)} DT</strong>
              </div>
              <div className="money-card negative">
                <span>👤 Salaire</span>
                <strong>-{salary.toFixed(2)} DT</strong>
              </div>
              <div className={`money-card ${adjustmentTotal >= 0 ? 'positive' : 'negative'}`}>
                <span>🔧 Corrections</span>
                <strong>{adjustmentTotal >= 0 ? '+' : ''}{adjustmentTotal.toFixed(2)} DT</strong>
              </div>
            </div>
            
            <div className="cash-control">
              <label>💵 Argent réellement compté dans la caisse (DT)</label>
              <input type="number" min="0" step="0.01" value={actualCashCounted} onChange={e => setActualCashCounted(e.target.value)} onBlur={handleSaveCashProgress} placeholder="Ex: 450.000" />
              <div className={`cash-result ${Math.abs(cashGap) < 0.01 ? 'same' : cashGap < 0 ? 'missing' : 'extra'}`}>
                {actualCashCounted === '' || actualCashCounted === undefined ? <span>Entrez le montant réel de la caisse pour vérifier le manque.</span> : Math.abs(cashGap) < 0.01 ? <><strong>✅ Caisse correcte</strong><span>Le cash réel correspond exactement au montant attendu.</span></> : cashGap < 0 ? <><strong>⚠️ MANQUE: {Math.abs(cashGap).toFixed(2)} DT</strong><span>La caisse contient moins que le montant attendu. Veuillez expliquer ce qu'il s'est passé.</span></> : <><strong>💰 EXCÉDENT: {cashGap.toFixed(2)} DT</strong><span>La caisse contient plus que le montant attendu.</span></>}
              </div>
              
              {actualCashCounted !== '' && actualCashCounted !== undefined && cashGap < 0 && (
                <div style={{
                  marginTop: '15px',
                  padding: '15px',
                  background: '#fff3cd',
                  borderRadius: '8px',
                  border: '1px solid #ffc107'
                }}>
                  <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
                    📝 Veuillez expliquer la raison du manque de {Math.abs(cashGap).toFixed(2)} DT :
                  </label>
                  <textarea 
                    rows="3" 
                    value={financialData.manqueNote} 
                    onChange={e => setFinancialData(prev => ({ ...prev, manqueNote: e.target.value }))}
                    onBlur={() => {
                      if (activeShift) {
                        api.post(`/shifts/${activeShift.id}/end-progress`, {
                          actualCashCounted: actualCashCounted === '' ? null : getNumber(actualCashCounted),
                          finalShiftNote: finalShiftNote || '',
                          manqueNote: financialData.manqueNote || ''
                        }).catch(() => {});
                      }
                    }}
                    placeholder="Ex: J'ai donné de la monnaie à un client, un client est parti sans payer, etc..."
                    style={{
                      width: '100%',
                      padding: '10px',
                      borderRadius: '6px',
                      border: '1px solid #ddd',
                      fontSize: '14px',
                      fontFamily: 'inherit'
                    }}
                  />
                </div>
              )}
            </div>

            <div className="wizard-nav" style={{ marginTop: '15px' }}>
              <button type="button" className="btn btn-secondary" onClick={handleSaveCashProgress}>💾 Enregistrer le comptage</button>
            </div>
            
            <div className="wizard-nav split">
              <button type="button" className="btn btn-secondary" onClick={() => setEndShiftStep(2)}>← Retour</button>
              <button type="button" className="btn btn-success btn-large" onClick={async () => { await handleSaveCashProgress(); await handleEndShift({ preventDefault: () => {} }) }}>✅ Finaliser le shift</button>
            </div>
          </>
        )}
      </div>
    )
  }

  /*
  ============================================================
  END SHIFT FORM
  ============================================================
  */

  const renderEndShiftForm = () => {
    const shiftStartTime = new Date(activeShift.start_time)
    const minutesSinceStart = (Date.now() - shiftStartTime.getTime()) / (1000 * 60)
    const isLocked = !isAdmin && minutesSinceStart > 15
    const totalWater05 = (parseInt(shiftMetrics.water05Sold) || 0) + (parseInt(shiftMetrics.kamia) || 0)
    const cannetteStaffItem = stock.find(item => {
      const name = `${item.display_name || ''} ${item.name || ''}`.toLowerCase()
      return name.includes('cannette') || name.includes('canette')
    })
    const cannetteStaffPrice = Number(cannetteStaffItem?.staff_price || 0)

    const metricInput = (label, key, icon = '') => (
      <div className="wizard-input" key={key}><label>{icon} {label}</label><input type="number" min="0" step="1" value={shiftMetrics[key]} onChange={e => updateMetric(key, e.target.value)} /></div>
    )

    if (endShiftStep > 0 && showPreview && previewData) {
      return <div className="endshift-shell">{renderPreviewDetails()}</div>
    }

    return (
      <div className="endshift-shell">
        <div className="wizard-topbar">
          <div><span className="phase-kicker">END SHIFT</span><h2>Clôture professionnelle du shift</h2><p>Étape de saisie — entrez les chiffres réels avant le contrôle automatique.</p></div>
          <div className="step-pills"><span className="active">1. Saisie</span><span>2. Correction</span><span>3. Final</span></div>
        </div>
        {isLocked && <div className="alert alert-warning">⚠️ Le shift est ancien. Après finalisation, seul l'administrateur pourra le modifier.</div>}
        <form onSubmit={handlePreviewShift}>
          <section className="wizard-section">
            <div className="section-title"><div><span>RAMI PAPER</span><h3>📄 Comptage du papier Rami</h3><p>Comptez les papiers qui restent au café à la fin du shift.</p></div></div>
            <div className="two-columns">
              <div className="wizard-input"><label>Début du shift</label><input type="number" value={activeShift.ramiPaperOpening ?? 0} readOnly /></div>
              <div className="wizard-input"><label>Ajouté pendant le shift</label><input type="number" value={activeShift.ramiPaperAdded ?? 0} readOnly /></div>
            </div>
            <div className="wizard-input"><label>📄 Papier restant à la fin</label>
              <input type="number" min="0" step="1" value={ramiPaperClosing} onChange={e => setRamiPaperClosing(e.target.value)} placeholder="Comptez le papier restant" />
            </div>

            <div className="section-title"><div><span>STOCK</span><h3>📦 Stock de fin de shift</h3><p>Entrez ce qui reste réellement au comptoir.</p></div></div>
            <div className="closing-stock-grid">
              {stock.filter(item => item.can_be_front !== false).map(item => {
                const current = parseFloat(item.front_quantity) || 0
                return <div className="wizard-input" key={item.id}><label>{item.display_name || item.name}<small>Disponible: {current} {item.unit}</small></label><input type="number" min="0" max={current} step={item.is_fractional ? '0.01' : '1'} value={closingStock[item.id] !== undefined && closingStock[item.id] !== '' ? closingStock[item.id] : ''} onChange={e => updateClosingStock(item.id, Math.min(parseFloat(e.target.value) || 0, current))} placeholder="Saisir le reste" /></div>
              })}
              {stock.filter(item => item.can_be_front === false).map(item => { const current=parseFloat(item.warehouse_quantity)||0; const key=`warehouse_close_${item.id}`; return <div className="wizard-input" key={key}><label>🏪 {item.display_name || item.name}<small>Stock dépôt à compter: {current} {item.unit}</small></label><input type="number" min="0" max={current} step={item.is_fractional ? '0.01' : '1'} value={formData[key] ?? current} onChange={e=>setFormData(prev=>({...prev,[key]:Math.min(parseFloat(e.target.value)||0,current)}))} /></div> })}
            </div>
          </section>

          <section className="wizard-section">
            <div className="section-title"><div><span>TICKET CAISSE</span><h3>🧾 Produits vendus</h3><p>Recopiez les quantités du ticket de la caisse.</p></div></div>
            <h4>💧 Eau</h4>
            <div className="metric-grid">
              {metricInput('EAU 0.5', 'water05Sold')}
              {metricInput('🫖 Kamia (1 Kamia = 1 Eau 0.5)', 'kamia')}
              
              {metricInput('EAU 1L', 'water1Sold')}
              {metricInput('EAU 1.5L', 'water15Sold')}
              {metricInput('EAU BOLAR', 'waterBolarSold')}
            </div>
            <div className="formula-banner" style={{ 
              marginTop: '10px', 
              padding: '12px', 
              background: '#fff3cd', 
              borderRadius: '8px',
              border: '1px solid #ffc107'
            }}>
              💡 <strong>Kamia = Chicha</strong>
              <span style={{ marginLeft: '15px' }}>
                Prix: Chicha <strong>{getCurrentChichaPrice().toFixed(2)} DT</strong> | Eau 0.5 <strong>{getProductPrice(['eau05','eau 0.5','water05','water 0.5']).toFixed(2)} DT</strong>
              </span>
              <span style={{ marginLeft: '15px' }}>
                Total EAU 0.5 = {shiftMetrics.water05Sold || 0} + {shiftMetrics.kamia || 0} = {totalWater05}
              </span>
            </div>
            <h4>🥤 Boissons</h4><div className="metric-grid">{metricInput('Gazeuses', 'sodaSold')}{metricInput('Cannettes', 'cannettesSold')}</div>
            <h4>🌿 Chicha</h4><div className="metric-grid">{metricInput('Chicha totale', 'chichaTotal')}{metricInput('Chicha personnelle', 'chichaPersonnel')}</div>
            <h4>☕ Café</h4><div className="metric-grid">{metricInput('Express', 'express')}{metricInput('Cappuccino', 'cappuccino')}{metricInput('Americain', 'americain')}{metricInput('Filtre', 'filter')}{metricInput('Direct', 'direct')}</div>
          </section>

          <section className="wizard-section two-columns">
            <div>
              <div className="section-title"><div><span>STAFF</span><h3>👥 Consommation du personnel</h3></div></div>
              <div className="metric-grid compact">
                <div className="wizard-input"><label>☕ Staff Coffee <small>{staffPrices.coffee.toFixed(2)} DT / unité</small></label><input type="number" min="0" value={formData.staffCoffee || ''} onChange={e => setFormData(prev => ({ ...prev, staffCoffee: e.target.value }))} /></div>
                <div className="wizard-input"><label>💧 Staff Water <small>{staffPrices.water.toFixed(2)} DT / unité</small></label><input type="number" min="0" value={formData.staffWater || ''} onChange={e => setFormData(prev => ({ ...prev, staffWater: e.target.value }))} /></div>
                <div className="wizard-input"><label>🥤 Staff Gazeuse <small>{staffPrices.soda.toFixed(2)} DT / unité</small></label><input type="number" min="0" value={formData.staffSoda || ''} onChange={e => setFormData(prev => ({ ...prev, staffSoda: e.target.value }))} /></div>
                <div className="wizard-input"><label>🥫 Staff Cannette <small>{staffPrices.cannette.toFixed(2)} DT / unité</small></label><input type="number" min="0" value={formData.staffCannette || ''} onChange={e => setFormData(prev => ({ ...prev, staffCannette: e.target.value }))} /></div>
              </div>
            </div>
            <div>
              <div className="section-title"><div><span>CAISSE</span><h3>💰 Informations financières</h3></div></div>
              <div className="wizard-input"><label>💵 Cash collecté (DT)</label><input type="number" min="0" step="0.01" required value={formData.cashCollected || ''} onChange={e => setFormData(prev => ({ ...prev, cashCollected: e.target.value }))} /></div>
              <div className="wizard-input"><label>🎮 Rami Games</label><input type="number" min="0" value={formData.ramiGamesUsed || ''} onChange={e => setFormData(prev => ({ ...prev, ramiGamesUsed: e.target.value }))} /></div>
            </div>
          </section>

          <section className="wizard-section financial-entry">
            <div className="section-title"><div><span>AJUSTEMENTS DÉCLARÉS</span><h3>💸 Dépenses & salaire</h3><p>Ces informations seront clairement visibles pour le propriétaire.</p></div></div>
            <div className="financial-grid">
              <div className="wizard-input"><label>💸 Dépenses (DT)</label><input type="number" min="0" step="0.01" value={financialData.expensesAmount} onChange={e => setFinancialData(prev => ({ ...prev, expensesAmount: e.target.value }))} /><textarea placeholder="Ex: achat charbon, nettoyage..." value={financialData.expensesNote} onChange={e => setFinancialData(prev => ({ ...prev, expensesNote: e.target.value }))} /></div>
              <div className="wizard-input"><label>👤 Salaire staff (DT)</label><input type="number" min="0" step="0.01" value={financialData.staffSalary} onChange={e => setFinancialData(prev => ({ ...prev, staffSalary: e.target.value }))} /></div>
            </div>
          </section>

          <div className="wizard-input"><label>📝 Note générale du shift</label><textarea rows="3" value={formData.notes || ''} onChange={e => setFormData(prev => ({ ...prev, notes: e.target.value }))} placeholder="Information importante pour le propriétaire..." /></div>
          <div className="wizard-nav"><button type="button" className="btn btn-secondary" onClick={() => setShowEndForm(false)}>Annuler</button><button type="submit" className="btn btn-primary btn-large">Step 1 → Contrôler la recette</button></div>
        </form>
      </div>
    )
  }

  /*
  ============================================================
  SHIFT CARD
  ============================================================
  */

  const renderShiftCard =
    shift => {

      const metrics =
        shift.shift_metrics ||
        shift.shiftMetrics ||
        {}

      return (

        <div
          key={shift.id}
          className={`shift-card ${shift.status}`}
        >

          <div className="shift-card-header">

            <span className="shift-id">
              #{shift.id}
            </span>

            <span
              className={`shift-status-badge ${shift.status}`}
            >
              {
                shift.status
              }
            </span>

            {shift.isFinalized && (
              <span className="lock-badge" style={{ color: '#27ae60', marginLeft: '10px' }}>
                ✅ Finalized
              </span>
            )}

          </div>

          <div className="shift-card-body">

            <div className="shift-user">

              👤{' '}
              {
                shift.username
              }

            </div>

            <div className="shift-times">

              <span>

                Started:
                {' '}
                {
                  shift.start_time
                    ? format(
                        new Date(
                          shift.start_time
                        ),
                        'dd/MM/yyyy HH:mm'
                      )
                    : '-'
                }

              </span>

              {shift.end_time && (
                <span>

                  Ended:
                  {' '}
                  {
                    format(
                      new Date(
                        shift.end_time
                      ),
                      'dd/MM/yyyy HH:mm'
                    )
                  }

                </span>
              )}

            </div>

            {shift.status ===
              'ended' && (
              <>
                <div className="shift-revenue">

                  Recette:
                  {' '}

                  <strong>

                    {
                      Number(
                        shift.final_recette ||
                        0
                      ).toFixed(2)
                    }

                    {' '}
                    DT

                  </strong>

                </div>

                <div
                  style={{
                    marginTop:
                      '10px',
                    fontSize:
                      '0.9rem'
                  }}
                >

                  🌿 Chicha:
                  {' '}
                  {
                    metrics.normalChicha ||
                    0
                  }
                  {' '}
                  normale

                  {' '}
                  |

                  {' '}
                  ☕ Café:
                  {' '}
                  {
                    metrics.coffeeCount ||
                    0
                  }

                  {' '}
                  |

                  {' '}
                  🫖 Kamia:
                  {' '}
                  {
                    metrics.kamia ||
                    0
                  }

                  {' '}
                  |

                  {' '}
                  💧 Eau 0.5 total:
                  {' '}
                  {((metrics.water05Sold || 0) + (metrics.kamia || 0))}

                  {' '}
                  |

                  {' '}
                  🥫 Cannettes:
                  {' '}
                  {metrics.cannettesSold || 0}

                </div>

                <button
                  className="btn btn-primary"
                  style={{
                    marginTop:
                      '12px'
                  }}
                  onClick={() =>
                    handleViewShiftDetails(
                      shift.id
                    )
                  }
                >
                  📊 View Details
                </button>

              </>
            )}

            {shift.status ===
              'active' && (
              <div
                style={{
                  marginTop:
                    '10px'
                }}
              >
                🔄 Active {shift.isFinalized && '✅ Finalized'}
              </div>
            )}

          </div>

        </div>
      )
    }

  /*
  ============================================================
  SHIFT DETAILS
  ============================================================
  */

  const renderShiftDetails =
    () => {

      if (!selectedShift) {
        return null
      }

      const metrics =
        selectedShift.shift_metrics ||
        selectedShift.shiftMetrics ||
        {}

      const n = value => Number(value) || 0

      if (!isAdmin) {
        return (
          <div className="form-card">
            <div className="phase-heading">
              <div>
                <span className="phase-kicker">SHIFT DETAILS</span>
                <h2>📊 Shift #{selectedShift.id}</h2>
                <p>Performance summary for this shift.</p>
              </div>
              <button className="btn btn-secondary" onClick={() => setSelectedShift(null)}>Close</button>
            </div>

            <div className="admin-shift-info">
              <div>👤 Worker: <strong>{selectedShift.username || '-'}</strong></div>
              <div>📅 Start: <strong>{selectedShift.start_time ? format(new Date(selectedShift.start_time), 'dd/MM/yyyy HH:mm') : '-'}</strong></div>
              <div>🏁 End: <strong>{selectedShift.end_time ? format(new Date(selectedShift.end_time), 'dd/MM/yyyy HH:mm') : '-'}</strong></div>
              <div>{selectedShift.isFinalized ? '🔒 Finalized' : '🔄 Not finalized'}</div>
            </div>

            <div className="wizard-section">
              <div className="section-title"><div><span>PERFORMANCE</span><h3>🌿 Chicha Performance</h3></div></div>
              <div className="comparison-table-wrap">
                <table className="comparison-table">
                  <tbody>
                    <tr><td>🌿 Total Chicha</td><td><strong>{n(metrics.chichaTotal)}</strong></td></tr>
                    <tr><td>💨 Chicha Normale</td><td>{n(metrics.normalChicha)}</td></tr>
                    <tr><td>👤 Chicha Personnel</td><td>{n(metrics.chichaPersonnel)}</td></tr>
                    <tr><td>🫖 Kamia</td><td>{n(metrics.kamia)}</td></tr>
                    <tr><td>🌱 Tombac Consumed</td><td>{n(metrics.tombacConsumed)}</td></tr>
                    <tr><td>Tombac / Normal Chicha</td><td>{n(metrics.normalChicha) > 0 ? (n(metrics.tombacConsumed) / n(metrics.normalChicha)).toFixed(3) : '0.000'}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="wizard-section">
              <div className="section-title"><div><span>PERFORMANCE</span><h3>☕ Coffee Performance</h3></div></div>
              <div className="comparison-table-wrap">
                <table className="comparison-table">
                  <tbody>
                    <tr><td>Express</td><td>{n(metrics.express)}</td></tr>
                    <tr><td>Cappuccino</td><td>{n(metrics.cappuccino)}</td></tr>
                    <tr><td>Américain</td><td>{n(metrics.americain)}</td></tr>
                    <tr><td>Filter</td><td>{n(metrics.filter)}</td></tr>
                    <tr><td>Direct</td><td>{n(metrics.direct)}</td></tr>
                    <tr><td><strong>☕ Total Coffee</strong></td><td><strong>{n(metrics.coffeeCount)}</strong></td></tr>
                    <tr><td>🫘 Coffee Beans Consumed</td><td><strong>{n(metrics.coffeeBeansConsumed)}</strong></td></tr>
                    <tr><td>Beans / Coffee</td><td>{n(metrics.coffeeCount) > 0 ? (n(metrics.coffeeBeansConsumed) / n(metrics.coffeeCount)).toFixed(4) : '0.0000'}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>

            {selectedShift.final_recette && (
              <div className="money-card final" style={{ marginTop: '15px' }}>
                <span>💰 Recette finale</span>
                <strong>{n(selectedShift.final_recette).toFixed(2)} DT</strong>
              </div>
            )}
          </div>
        )
      }

      const financial =
        selectedShift.financial_data ||
        selectedShift.financialData ||
        {}

      const recipe =
        selectedShift.recette_breakdown_data ||
        selectedShift.recette_breakdown ||
        selectedShift.recetteBreakdown ||
        {}

      const stockConsumption =
        selectedShift.stock_consumption ||
        selectedShift.stockConsumption ||
        []

      let corrections =
        selectedShift.correction_actions ||
        selectedShift.correctionActions ||
        []

      if (!Array.isArray(corrections)) {
        corrections = []
      }

      const number = value => {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : 0
      }

      const fixed = value =>
        number(value).toFixed(2)

      const cashCollected =
        number(
          financial.cashCollected ??
          recipe.cash ??
          selectedShift.cash_collected
        )

      const ramiRevenue =
        number(
          financial.ramiRevenue ??
          recipe.rami ??
          0
        )

      const ramiGamesUsed =
        number(
          financial.ramiGamesUsed ??
          0
        )

      const staffCoffee =
        number(
          financial.staffCoffeeCost ??
          recipe.staffCoffee ??
          0
        )

      const staffWater =
        number(
          financial.staffWaterCost ??
          recipe.staffWater ??
          0
        )

      const staffSoda =
        number(
          financial.staffSodaCost ??
          recipe.staffSoda ??
          0
        )

      const staffCannette =
        number(
          financial.staffCannetteCost ??
          recipe.staffCannette ??
          0
        )

      const staffTotal =
        number(
          financial.staffTotal ??
          recipe.staffTotal ??
          (
            staffCoffee +
            staffWater +
            staffSoda +
            staffCannette
          )
        )

      const expenseAmount =
        number(
          financial.expensesAmount ??
          financial.expenseAmount ??
          recipe.expenses ??
          recipe.expense ??
          selectedShift.expenses_amount ??
          0
        )

      const expenseNote =
        financial.expensesNote ||
        financial.expenseNote ||
        recipe.expensesNote ||
        selectedShift.expenses_note ||
        ''

      const staffSalary =
        number(
          financial.staffSalary ??
          recipe.staffSalary ??
          0
        )

      const declaredManque =
        number(
          financial.manqueAmount ??
          selectedShift.manque_amount ??
          Math.max(0, number(selectedShift.final_recette ?? recipe.final ?? 0) - number(selectedShift.actual_cash_counted))
        )

      const manqueNote =
        financial.manqueNote ||
        selectedShift.manque_note ||
        (selectedShift.actual_cash_counted != null ? (declaredManque > 0 ? 'Manque calculé automatiquement.' : 'Aucun manque.') : '')

      const acceptedCorrections =
        Array.isArray(corrections)
          ? corrections.filter(
              action =>
                action &&
                action.accepted !== false
            )
          : []

      const correctionNet =
        acceptedCorrections.reduce(
          (sum, action) => {

            const amount =
              number(action.amount)

            if (
              action.direction ===
              'remove_from_cash'
            ) {
              return sum - amount
            }

            return sum + amount

          },
          0
        )

      const calculatedFinal =
        cashCollected +
        ramiRevenue +
        staffTotal -
        expenseAmount -
        staffSalary +
        correctionNet

      const finalRecette =
        number(
          selectedShift.final_recette ??
          recipe.final ??
          calculatedFinal
        )

      const kamia =
        number(metrics.kamia)

      const chichaPersonnel =
        number(metrics.chichaPersonnel)

      const normalChicha =
        number(
          metrics.normalChicha ??
          (
            number(metrics.chichaTotal) -
            chichaPersonnel
          )
        )

      const totalChicha =
        number(
          metrics.chichaTotal ??
          (
            normalChicha +
            chichaPersonnel          )
        )

      const chichaMatchesKamia =
        Math.abs(
          kamia -
          totalChicha
        ) < 0.1

      const water05Sold =
        number(metrics.water05Sold)

      const water1Sold =
        number(metrics.water1Sold)

      const water15Sold =
        number(metrics.water15Sold)

      const waterBolarSold =
        number(metrics.waterBolarSold)

      const water05TotalSold =
        water05Sold +
        kamia

      const getConsumedByName = keywords => {
        const found = stockConsumption.find(item => {
          const name = `${item.name || ''} ${item.itemName || ''} ${item.item_name || ''}`.toLowerCase()
          return keywords.some(keyword => name.includes(keyword))
        })
        return number(
          found?.consumedQuantity ??
          found?.consumed_quantity ??
          0
        )
      }

      const water05Consumed =
        number(metrics.water05Consumed) ||
        getConsumedByName(['eau05', 'eau 0.5', 'water05', 'water 0.5'])

      const water1Consumed =
        number(metrics.water1Consumed) ||
        getConsumedByName(['eau1', 'eau 1', '1l', '1 l', 'water1'])

      const water15Consumed =
        number(metrics.water15Consumed) ||
        getConsumedByName(['eau15', 'eau 1.5', '1.5l', 'water15'])

      const waterBolarConsumed =
        number(metrics.waterBolarConsumed) ||
        getConsumedByName(['bolar', 'eau bolar', 'waterbolar'])

      const water05Difference =
        number(
          metrics.water05Difference ??
          (
            water05TotalSold -
            water05Consumed
          )
        )

      const water1Difference =
        number(
          metrics.water1Difference ??
          (
            water1Sold -
            water1Consumed
          )
        )

      const water15Difference =
        number(
          metrics.water15Difference ??
          (
            water15Sold -
            water15Consumed
          )
        )

      const waterBolarDifference =
        number(
          metrics.waterBolarDifference ??
          (
            waterBolarSold -
            waterBolarConsumed
          )
        )

      const sodaSold =
        number(metrics.sodaSold)

      const sodaConsumed =
        number(metrics.sodaConsumed) ||
        getConsumedByName(['gazeuse', 'soda'])

      const sodaDifference =
        number(
          metrics.sodaDifference ??
          (
            sodaSold -
            sodaConsumed
          )
        )

      const cannettesSold =
        number(metrics.cannettesSold)

      const cannettesConsumed =
        number(metrics.cannettesConsumed) ||
        getConsumedByName(['cannette', 'canette', 'can', 'boite'])

      const cannettesDifference =
        number(
          metrics.cannettesDifference ??
          (
            cannettesSold -
            cannettesConsumed
          )
        )

      const express =
        number(metrics.express)

      const cappuccino =
        number(metrics.cappuccino)

      const americain =
        number(metrics.americain)

      const filterCoffee =
        number(metrics.filter)

      const direct =
        number(metrics.direct)

      const calculatedCoffeeCount =
        express +
        cappuccino +
        americain +
        filterCoffee +
        direct

      const coffeeCount =
        number(
          metrics.coffeeCount ||
          calculatedCoffeeCount
        )

      const coffeeBeans =
        number(
          metrics.coffeeBeansConsumed
        ) ||
        getConsumedByName(['coffee beans', 'coffee bean', 'grain cafe', 'grains cafe', 'cafe en grain', 'cafe beans'])

      const tombac =
        number(
          metrics.tombacConsumed
        ) ||
        getConsumedByName(['tombac', 'tabac chicha', 'chicha tobacco'])

      const chichaKamiaDifference =
        number(metrics.chichaKamiaDifference)

      const getStatus = difference => {

        const diff =
          number(difference)

        if (
          Math.abs(diff) < 0.1
        ) {
          return (
            <span className="status status-ok">
              ✅ OK
            </span>
          )
        }

        if (
          diff > 0
        ) {
          return (
            <span className="status status-warn">
              ⚠️ Plus vendu que consommé
            </span>
          )
        }

        return (
          <span className="status status-danger">
            ⚠️ Plus consommé que vendu
          </span>
        )
      }

      const getDifferenceClass =
        difference => {

          const diff =
            number(difference)

          if (
            Math.abs(diff) < 0.1
          ) {
            return 'diff-ok'
          }

          if (
            diff > 0
          ) {
            return 'diff-warn'
          }

          return 'diff-danger'
        }

      const controlRows = [

        {
          category: '💧 Eau',
          product: 'EAU 0.5 + Kamia',
          sold: water05TotalSold,
          consumed: water05Consumed,
          difference: water05Difference
        },

        {
          category: '💧 Eau',
          product: 'EAU 1',
          sold: water1Sold,
          consumed: water1Consumed,
          difference: water1Difference
        },

        {
          category: '💧 Eau',
          product: 'EAU 1.5',
          sold: water15Sold,
          consumed: water15Consumed,
          difference: water15Difference
        },

        {
          category: '💧 Eau',
          product: 'EAU BOLAR',
          sold: waterBolarSold,
          consumed: waterBolarConsumed,
          difference: waterBolarDifference
        },

        {
          category: '🥤 Gazeuses',
          product: 'Gazeuses',
          sold: sodaSold,
          consumed: sodaConsumed,
          difference: sodaDifference
        },

        {
          category: '🥫 Cannettes',
          product: 'Cannettes',
          sold: cannettesSold,
          consumed: cannettesConsumed,
          difference: cannettesDifference
        }

      ]

      const chichaPriceFromStock = (() => {
        const chichaItem = stock.find(item => {
          const name = `${item.name || ''} ${item.display_name || ''}`.toLowerCase()
          return name.includes('chicha') || name.includes('shisha')
        })
        if (chichaItem && chichaItem.price) {
          return parseFloat(chichaItem.price)
        }
        return 7
      })()

      return (

        <div className="form-card admin-shift-details">

          <div
            className="phase-heading"
          >

            <div>

              <span className="phase-kicker">
                ADMIN AUDIT
              </span>

              <h2>
                📊 Shift #{selectedShift.id}
              </h2>

              <p>
                Complete shift audit:
                financial data,
                worker validation,
                corrections,
                performance and stock consumption.
              </p>

            </div>

            <button
              className="btn btn-secondary"
              onClick={() =>
                setSelectedShift(null)
              }
            >
              Close
            </button>

          </div>

          <div
            className="admin-shift-info"
          >

            <div>
              👤 Worker:
              {' '}
              <strong>
                {selectedShift.username || '-'}
              </strong>
            </div>

            <div>
              📅 Start:
              {' '}
              <strong>
                {
                  selectedShift.start_time
                    ? format(
                        new Date(
                          selectedShift.start_time
                        ),
                        'dd/MM/yyyy HH:mm'
                      )
                    : '-'
                }
              </strong>
            </div>

            <div>
              🏁 End:
              {' '}
              <strong>
                {
                  selectedShift.end_time
                    ? format(
                        new Date(
                          selectedShift.end_time
                        ),
                        'dd/MM/yyyy HH:mm'
                      )
                    : '-'
                }
              </strong>
            </div>

            <div>
              {
                selectedShift.isFinalized
                  ? '🔒 Finalized'
                  : '🔄 Not finalized'
              }
            </div>

          </div>


          {/* 1 - FINANCIAL BREAKDOWN */}
          <div className="wizard-section">

            <div className="section-title">

              <div>

                <span>
                  FINAL FINANCIAL RESULT
                </span>

                <h3>
                  💰 Financial Breakdown
                </h3>

                <p>
                  Complete explanation of how the final recette was calculated.
                </p>

              </div>

            </div>

            <div className="financial-grid">

              <div className="money-card">

                <span>
                  💵 Cash Collected
                </span>

                <strong>
                  {fixed(cashCollected)} DT
                </strong>

              </div>

              <div className="money-card positive">

                <span>
                  🎮 Rami Revenue
                </span>

                <strong>
                  +{fixed(ramiRevenue)} DT
                </strong>

                <small>
                  {ramiGamesUsed} games
                </small>

              </div>

              <div className="money-card negative">

                <span>
                  ☕ Staff Coffee
                </span>

                <strong>
                  -{fixed(staffCoffee)} DT
                </strong>

              </div>

              <div className="money-card negative">

                <span>
                  💧 Staff Water
                </span>

                <strong>
                  -{fixed(staffWater)} DT
                </strong>

              </div>

              <div className="money-card negative">

                <span>
                  🥤 Staff Gazeuse
                </span>

                <strong>
                  -{fixed(staffSoda)} DT
                </strong>

              </div>

              <div className="money-card negative">

                <span>
                  🥫 Staff Cannette
                </span>

                <strong>
                  -{fixed(staffCannette)} DT
                </strong>

              </div>

              <div className="money-card negative">

                <span>
                  👥 Total Staff Consumption
                </span>

                <strong>
                  -{fixed(staffTotal)} DT
                </strong>

              </div>

              <div className="money-card negative">

                <span>
                  💸 Expenses
                </span>

                <strong>
                  -{fixed(expenseAmount)} DT
                </strong>

                <small>
                  {
                    expenseNote ||
                    'No expense note'
                  }
                </small>

              </div>

              <div className="money-card negative">

                <span>
                  💼 Staff Salary
                </span>

                <strong>
                  -{fixed(staffSalary)} DT
                </strong>

              </div>

              <div
                className={
                  `money-card ${correctionNet >= 0 ? 'positive' : 'negative'}`
                }
              >

                <span>
                  🔧 Accepted Corrections
                </span>

                <strong>
                  {correctionNet >= 0 ? '+' : ''}{fixed(correctionNet)} DT
                </strong>

              </div>

              <div className="money-card">
                <span>
                  💵 Argent réellement compté dans la caisse
                </span>
                <strong>
                  {fixed(selectedShift.actual_cash_counted)} DT
                </strong>
                {declaredManque > 0 && (
                  <small style={{ display: 'block', marginTop: '5px', color: '#e74c3c' }}>
                    ⚠️ Manque: {fixed(declaredManque)} DT
                    {manqueNote && (
                      <>
                        <br />
                        📝 Note: {manqueNote}
                      </>
                    )}
                  </small>
                )}
                {declaredManque === 0 && selectedShift.actual_cash_counted !== null && (
                  <small style={{ display: 'block', marginTop: '5px', color: '#27ae60' }}>
                    ✅ Aucun manque
                  </small>
                )}
              </div>

              <div className="money-card final">

                <span>
                  🏦 FINAL RECETTE
                </span>

                <strong>
                  {fixed(finalRecette)} DT
                </strong>

              </div>

            </div>

          </div>


          {/* 2 - ORIGINAL DATA CONTROL */}
          <div className="wizard-section">

            <div className="section-title">

              <div>

                <span>
                  PHASE 1 — WORKER VALIDATED DATA
                </span>

                <h3>
                  📊 CONTRÔLE DES DONNÉES
                </h3>

                <p>
                  This is the original comparison between
                  ticket sales and physical stock consumption
                  before the correction phase.
                </p>

              </div>

            </div>

            <div
              className={
                `kamia-check ${chichaMatchesKamia ? 'same' : 'different'}`
              }
            >

              <span>
                🫖 {' '}
                <strong>Kamia:</strong> {' '}
                {fixed(kamia)}
              </span>

              <span>
                │
              </span>

              <span>
                🌿 {' '}
                <strong>Total Chicha:</strong> {' '}
                {fixed(totalChicha)}
              </span>

              <b>
                {chichaMatchesKamia ? '✅ Same' : '❌ Different'}
              </b>

              {!chichaMatchesKamia && (
                <div style={{ fontSize: '0.8rem', color: '#e67e22', marginTop: '5px' }}>
                  Écart: {fixed(totalChicha - kamia)} (Chicha - Kamia)
                </div>
              )}

            </div>

            <h4>💧 Eau</h4>

            <div className="comparison-table-wrap">

              <table className="comparison-table">

                <thead>

                  <tr>
                    <th>Produit</th>
                    <th>Vendu (Ticket)</th>
                    <th>Consommé (Stock)</th>
                    <th>Différence</th>
                    <th>Status</th>
                  </tr>

                </thead>

                <tbody>

                  {controlRows
                    .filter(row => row.category === '💧 Eau')
                    .map(row => (

                      <tr key={row.product}>

                        <td><strong>{row.product}</strong></td>
                        <td>{fixed(row.sold)}</td>
                        <td><strong>{fixed(row.consumed)}</strong></td>
                        <td className={getDifferenceClass(row.difference)}>
                          {row.difference > 0 ? '+' : ''}{fixed(row.difference)}
                        </td>
                        <td>{getStatus(row.difference)}</td>

                      </tr>

                    ))}

                </tbody>

              </table>

            </div>

            <h4>🥤 Gazeuses</h4>

            <div className="comparison-table-wrap">

              <table className="comparison-table">

                <thead>

                  <tr>
                    <th>Produit</th>
                    <th>Vendu (Ticket)</th>
                    <th>Consommé (Stock)</th>
                    <th>Différence</th>
                    <th>Status</th>
                  </tr>

                </thead>

                <tbody>

                  {controlRows
                    .filter(row => row.category === '🥤 Gazeuses')
                    .map(row => (

                      <tr key={row.product}>

                        <td><strong>{row.product}</strong></td>
                        <td>{fixed(row.sold)}</td>
                        <td><strong>{fixed(row.consumed)}</strong></td>
                        <td className={getDifferenceClass(row.difference)}>
                          {row.difference > 0 ? '+' : ''}{fixed(row.difference)}
                        </td>
                        <td>{getStatus(row.difference)}</td>

                      </tr>

                    ))}

                </tbody>

              </table>

            </div>

            <h4>🥫 Cannettes</h4>

            <div className="comparison-table-wrap">

              <table className="comparison-table">

                <thead>

                  <tr>
                    <th>Produit</th>
                    <th>Vendu (Ticket)</th>
                    <th>Consommé (Stock)</th>
                    <th>Différence</th>
                    <th>Status</th>
                  </tr>

                </thead>

                <tbody>

                  {controlRows
                    .filter(row => row.category === '🥫 Cannettes')
                    .map(row => (

                      <tr key={row.product}>

                        <td><strong>{row.product}</strong></td>
                        <td>{fixed(row.sold)}</td>
                        <td><strong>{fixed(row.consumed)}</strong></td>
                        <td className={getDifferenceClass(row.difference)}>
                          {row.difference > 0 ? '+' : ''}{fixed(row.difference)}
                        </td>
                        <td>{getStatus(row.difference)}</td>

                      </tr>

                    ))}

                </tbody>

              </table>

            </div>

          </div>


          {/* 3 - CORRECTION PHASE */}
          <div className="wizard-section">

            <div className="section-title">

              <div>

                <span>
                  PHASE 2 — WORKER DECISIONS
                </span>

                <h3>
                  🔧 CORRECTION DE LA RECETTE
                </h3>

                <p>
                  Here the admin can see exactly
                  which corrections the worker accepted
                  and how each correction changed the caisse.
                </p>

              </div>

            </div>

            {
              corrections && Array.isArray(corrections) && corrections.length === 0
                ? (

                  <div className="empty-state">
                    No correction data was recorded for this shift.
                  </div>

                )
                : (
                  <div className="comparison-table-wrap">

                    <table className="comparison-table">

                      <thead>

                        <tr>
                          <th>Product</th>
                          <th>Original Difference</th>
                          <th>Worker Decision</th>
                          <th>Quantity Fixed</th>
                          <th>Unit Price</th>
                          <th>Action</th>
                          <th>Impact on Caisse</th>
                        </tr>

                      </thead>

                      <tbody>

                        {corrections && Array.isArray(corrections) && corrections.map(
                          (action, index) => {

                            const accepted = action.accepted !== false
                            const amount = number(action.amount)
                            const quantity = number(action.quantity)
                            const unitPrice = number(action.unitPrice)
                            const difference = number(action.difference)
                            const remove = action.direction === 'remove_from_cash'

                            return (

                              <tr key={action.id || `${action.product}-${index}`}>

                                <td>
                                  <strong>{action.product || '-'}</strong>
                                  {action.classification && (
                                    <div style={{
                                      marginTop: '6px',
                                      fontSize: '0.82rem',
                                      color: '#555'
                                    }}>
                                      🌿 Chicha: {number(action.classification.chicha)}
                                      {' · '}
                                      💧 Eau 0.5: {number(action.classification.water05)}
                                      {number(action.classification.remainingWater05) > 0 && (
                                        <>
                                          {' · '}
                                          Eau non classée: {number(action.classification.remainingWater05)}
                                        </>
                                      )}
                                    </div>
                                  )}
                                  {action.deduction && (
                                    <div style={{
                                      marginTop: '6px',
                                      fontSize: '0.82rem',
                                      color: '#555'
                                    }}>
                                      🔽 Chicha déduite: {number(action.deduction.chicha)}
                                      {' · '}
                                      💧 Eau 0.5 déduite: {number(action.deduction.water05)}
                                      {number(action.deduction.remainingWater05) > 0 && (
                                        <>
                                          {' · '}
                                          Reste à déduire: {number(action.deduction.remainingWater05)}
                                        </>
                                      )}
                                    </div>
                                  )}
                                </td>

                                <td className={getDifferenceClass(difference)}>
                                  {difference > 0 ? '+' : ''}{fixed(difference)}
                                </td>

                                <td>
                                  {accepted ? (
                                    <span className="status status-ok">✅ Accepted</span>
                                  ) : (
                                    <span className="status status-danger">❌ Not accepted</span>
                                  )}
                                </td>

                                <td>{fixed(quantity)}</td>

                                <td>
                                  {action.classification || action.deduction ? (
                                    <>
                                      <div>🌿 Chicha: <strong>{chichaPriceFromStock.toFixed(2)} DT</strong></div>
                                      <div>💧 Eau 0.5: <strong>2.00 DT</strong></div>
                                    </>
                                  ) : (
                                    <>{fixed(unitPrice)} DT</>
                                  )}
                                </td>

                                <td>
                                  {accepted ? (
                                    remove ? '➖ Removed from caisse' : '➕ Added to caisse'
                                  ) : 'No change'}
                                </td>

                                <td className={accepted ? (remove ? 'diff-danger' : 'diff-ok') : ''}>
                                  {accepted ? (
                                    <>
                                      {remove ? '-' : '+'}{fixed(amount)} DT
                                    </>
                                  ) : '0.00 DT'}
                                </td>

                              </tr>

                            )

                          }
                        )}

                      </tbody>

                    </table>

                  </div>
                )
            }

            <div className="fix-summary">

              <div>

                <span>Total accepted corrections</span>
                <strong>{correctionNet >= 0 ? '+' : ''}{fixed(correctionNet)} DT</strong>

              </div>

              <div>

                <span>Accepted operations</span>
                <strong>{acceptedCorrections && Array.isArray(acceptedCorrections) ? acceptedCorrections.length : 0}</strong>

              </div>

              <div>

                <span>Total operations</span>
                <strong>{corrections && Array.isArray(corrections) ? corrections.length : 0}</strong>

              </div>

            </div>

          </div>


          {/* 4 - CHICHA PERFORMANCE */}
          <div className="wizard-section">

            <div className="section-title">

              <div>

                <span>PERFORMANCE</span>
                <h3>🌿 Chicha Performance</h3>
                <p>Chicha activity and Tombac consumption.</p>

              </div>

            </div>

            <div className="comparison-table-wrap">

              <table className="comparison-table">

                <tbody>

                  <tr><td>🌿 Total Chicha</td><td><strong>{fixed(totalChicha)}</strong></td></tr>
                  <tr><td>💨 Chicha Normale</td><td>{fixed(normalChicha)}</td></tr>
                  <tr><td>👤 Chicha Personnel</td><td>{fixed(chichaPersonnel)}</td></tr>
                  <tr><td>🫖 Kamia</td><td>{fixed(kamia)}</td></tr>
                  <tr>
                    <td>📊 Chicha - Kamia (Écart)</td>
                    <td>
                      <strong>{fixed(totalChicha - kamia)}</strong>
                      {Math.abs(totalChicha - kamia) > 0.1 && (
                        <span style={{ color: '#e74c3c', marginLeft: '10px' }}>
                          ⚠️ {totalChicha > kamia ? 'Plus de Chicha que de Kamia' : 'Plus de Kamia que de Chicha'}
                        </span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td>Kamia vs Total Chicha</td>
                    <td>
                      {Math.abs(totalChicha - kamia) < 0.1 ? (
                        <span className="status status-ok">✅ Same</span>
                      ) : (
                        <span className="status status-danger">❌ Different ({fixed(totalChicha - kamia)})</span>
                      )}
                    </td>
                  </tr>
                  <tr><td>🌱 Tombac Consumed</td><td>{fixed(tombac)}</td></tr>
                  <tr>
                    <td>Tombac / Normal Chicha</td>
                    <td>{normalChicha > 0 ? (tombac / normalChicha).toFixed(3) : '0.000'}</td>
                  </tr>

                </tbody>

              </table>

            </div>

          </div>


          {/* 5 - COFFEE PERFORMANCE */}
          <div className="wizard-section">

            <div className="section-title">

              <div>

                <span>PERFORMANCE</span>
                <h3>☕ Coffee Performance</h3>
                <p>Coffee sales and coffee beans consumption.</p>

              </div>

            </div>

            <div className="comparison-table-wrap">

              <table className="comparison-table">

                <tbody>

                  <tr><td>Express</td><td>{fixed(express)}</td></tr>
                  <tr><td>Cappuccino</td><td>{fixed(cappuccino)}</td></tr>
                  <tr><td>Américain</td><td>{fixed(americain)}</td></tr>
                  <tr><td>Filter</td><td>{fixed(filterCoffee)}</td></tr>
                  <tr><td>Direct</td><td>{fixed(direct)}</td></tr>
                  <tr><td><strong>☕ Total Coffee</strong></td><td><strong>{fixed(coffeeCount)}</strong></td></tr>
                  <tr>
                    <td>🫘 Coffee Beans Consumed</td>
                    <td>
                      <strong>{fixed(coffeeBeans)}</strong>
                      {coffeeBeans === 0 && coffeeCount > 0 && (
                        <span style={{ color: '#e67e22', marginLeft: '10px', fontSize: '0.8rem' }}>
                          ⚠️ No beans consumed
                        </span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td>Beans / Coffee</td>
                    <td>{coffeeCount > 0 ? (coffeeBeans / coffeeCount).toFixed(4) : '0.0000'}</td>
                  </tr>

                </tbody>

              </table>

            </div>

          </div>


          {/* 6 - STOCK CONSUMPTION */}
          <div className="wizard-section">

            <div className="section-title">

              <div>

                <span>PHYSICAL STOCK</span>
                <h3>📦 Stock Consumption Details</h3>
                <p>Opening stock + additions − closing stock = consumed quantity.</p>

              </div>

            </div>

            {
              stockConsumption.length === 0
                ? (

                  <div className="empty-state">
                    No stock consumption data available for this shift.
                  </div>

                )
                : (

                  <div className="comparison-table-wrap">

                    <table className="comparison-table">

                      <thead>

                        <tr>
                          <th>Product</th>
                          <th>Opening</th>
                          <th>Added</th>
                          <th>Closing</th>
                          <th>Consumed</th>
                        </tr>

                      </thead>

                      <tbody>

                        {stockConsumption.map(
                          (item, index) => (

                            <tr key={item.itemId || item.id || index}>

                              <td>
                                <strong>{item.itemName || item.name || item.display_name || 'Unknown product'}</strong>
                              </td>
                              <td>{fixed(item.openingQuantity ?? item.opening_quantity)}</td>
                              <td>{fixed(item.addedQuantity ?? item.added_quantity)}</td>
                              <td>{fixed(item.closingQuantity ?? item.closing_quantity)}</td>
                              <td><strong>{fixed(item.consumedQuantity ?? item.consumed_quantity)}</strong></td>

                            </tr>

                          )
                        )}

                      </tbody>

                    </table>

                  </div>

                )
            }

          </div>


          {/* RAMI PAPER */}
          <div className="wizard-section">
            <div className="section-title">
              <div>
                <span>RAMI PAPER</span>
                <h3>📄 Papier Rami</h3>
                <p>Suivi indépendant du stock normal.</p>
              </div>
            </div>
            {(() => {
              const rp = selectedShift.ramiPaper || {}
              return (
                <div className="final-details">
                  <div><span>Début</span><b>{number(rp.opening ?? selectedShift.rami_paper_opening)} papier(s)</b></div>
                  <div><span>Ajouté</span><b>+{number(rp.added ?? selectedShift.rami_paper_added)} papier(s)</b></div>
                  <div><span>Fin</span><b>{number(rp.closing ?? selectedShift.rami_paper_closing)} papier(s)</b></div>
                  <div><span>Utilisé</span><b>{number(rp.used ?? selectedShift.rami_paper_used)} papier(s)</b></div>
                </div>
              )
            })()}
          </div>

          {/* WORKER DECLARATIONS */}
          <div className="wizard-section">

            <div className="section-title">

              <div>

                <span>WORKER DECLARATION</span>
                <h3>📝 End Shift Notes & Declarations</h3>

              </div>

            </div>

            <div className="final-details">

              <div>
                <span>Expense Note</span>
                <b>{expenseNote || 'No expense declared'}</b>
              </div>

              <div>
                <span>Manque Note</span>
                <b>{manqueNote || 'No manque declared'}</b>
              </div>

              <div>
                <span>Worker Note</span>
                <b>{selectedShift.notes || selectedShift.workerMessage || 'No note'}</b>
              </div>

              <div>
                <span>Shift Status</span>
                <b>{selectedShift.isFinalized ? '✅ Finalized' : (selectedShift.status || 'Unknown')}</b>
              </div>

            </div>

          </div>

        </div>

      )
    }

  /*
  ============================================================
  LOADING
  ============================================================
  */

  if (loading) {

    return (
      <div className="loading-screen">
        Loading shifts...
      </div>
    )
  }

  /*
  ============================================================
  PAGE
  ============================================================
  */

  return (

    <div className="shift-management">

      <div className="page-header">

        <h1>
          Shift Management
        </h1>

        <div className="header-actions">

          {!activeShift &&
            !showStartForm && (
              <button
                onClick={handleShowStartForm}
                className="btn btn-primary"
                disabled={startFormLoading}
              >
                {startFormLoading ? 'Loading...' : '🚀 Start Shift'}
              </button>
            )}

          {activeShift &&
            !showEndForm &&
            !showAddStockForm &&
            !activeShift.isFinalized && (
              <>
                <button
                  onClick={() =>
                    setShowAddStockForm(
                      true
                    )
                  }
                  className="btn btn-primary"
                >
                  ➕ Add Stock
                </button>

                <button
                  onClick={() => {
                    setShowEndForm(true)
                    setShowPreview(false)
                    setPreviewData(null)
                  }}
                  className="btn btn-success"
                >
                  ✅ End Shift
                </button>
              </>
            )}

          {activeShift && activeShift.isFinalized && (
            <span className="btn btn-success" style={{ opacity: 0.7, cursor: 'default' }}>
              ✅ Finalized
            </span>
          )}

        </div>

      </div>

      {message.text && (
        <div
          className={`alert alert-${message.type}`}
        >
          {message.text}
        </div>
      )}

      {activeShift && !isAdmin && !showEndForm && (
        <div className="wizard-section" style={{ marginBottom: '15px' }}>
          <div className="section-title">
            <div><span>RAMI PAPER</span><h3>📄 Papier Rami</h3>
              <p>Stock actuel au café : <strong>{Number(ramiPaperStock?.quantity ?? activeShift.ramiPaperClosing ?? 0)}</strong> papier(s).</p>
              {ramiPaperStock?.last_added_at && <small>Dernier ajout : {new Date(ramiPaperStock.last_added_at).toLocaleString()} {ramiPaperStock.last_added_by_username ? `par ${ramiPaperStock.last_added_by_username}` : ''}</small>}
            </div>
          </div>
          <div style={{ display:'flex', gap:'10px', alignItems:'end', flexWrap:'wrap' }}>
            <div className="wizard-input"><label>Ajouter des papiers</label><input type="number" min="1" step="1" value={ramiPaperAdding} onChange={e => setRamiPaperAdding(e.target.value)} placeholder="Quantité" /></div>
            <button type="button" className="btn btn-primary" onClick={handleAddRamiPaper} disabled={ramiPaperLoading || !ramiPaperAdding}>➕ Ajouter papier Rami</button>
          </div>
        </div>
      )}

      {showStartForm &&
        renderStartShiftForm()}

      {showAddStockForm &&
        activeShift &&
        renderAddStockForm()}

      {showEndForm &&
        activeShift &&
        renderEndShiftForm()}

      {activeShift && (
        <div className="active-shift-banner">

          <div className="banner-content">

            <span className="banner-icon">
              🔄
            </span>

            <div className="banner-info">

              <strong>
                Active Shift
              </strong>

              <span>
                Started{' '}
                {
                  formatDistanceToNow(
                    new Date(
                      activeShift.start_time
                    )
                  )
                } ago
              </span>

              <span className="banner-user">

                by{' '}
                {
                  activeShift.username
                }

              </span>

              {activeShift.isFinalized && (
                <span className="banner-lock" style={{ color: '#27ae60', marginLeft: '10px', fontWeight: 'bold' }}>
                  ✅ Finalized
                </span>
              )}

              {!isAdmin && !canEditShift(activeShift.start_time) && !activeShift.isFinalized && (
                <span className="banner-lock" style={{ color: '#e74c3c', marginLeft: '10px', fontWeight: 'bold' }}>
                  🔒 Locked (15min passed)
                </span>
              )}

              {!isAdmin && canEditShift(activeShift.start_time) && !activeShift.isFinalized && (
                <span className="banner-lock" style={{ color: '#27ae60', marginLeft: '10px', fontSize: '0.85rem' }}>
                  ⏳ {Math.max(0, 15 - Math.round((Date.now() - new Date(activeShift.start_time).getTime()) / (1000 * 60)))} min remaining to edit
                </span>
              )}

            </div>

          </div>

        </div>
      )}

      {finalizedSummary && !isAdmin && (
        <div className="wizard-section">
          <div className="section-title"><div><span>SHIFT FINALISÉ</span><h3>📊 Performance finale</h3></div></div>
          <div className="financial-grid">
            <div className="money-card"><span>🌿 Chicha normale</span><strong>{Number(finalizedSummary.shiftMetrics?.normalChicha ?? finalizedSummary.shift_metrics?.normalChicha ?? 0)}</strong></div>
            <div className="money-card"><span>☕ Cafés</span><strong>{Number(finalizedSummary.shiftMetrics?.coffeeCount ?? finalizedSummary.shift_metrics?.coffeeCount ?? 0)}</strong></div>
            <div className="money-card"><span>🫘 Grains consommés</span><strong>{Number(finalizedSummary.shiftMetrics?.coffeeBeansConsumed ?? finalizedSummary.shift_metrics?.coffeeBeansConsumed ?? 0).toFixed(2)}</strong></div>
            <div className="money-card final"><span>💰 Recette finale</span><strong>{Number(finalizedSummary.finalRecette ?? finalizedSummary.recette ?? 0).toFixed(2)} DT</strong></div>
          </div>
        </div>
      )}

      {selectedShift &&
        renderShiftDetails()}

      <div className="shifts-list">

        <h2>
          Shift History
        </h2>

        {shifts.length === 0 ? (

          <p className="empty-state">
            No shifts recorded yet.
          </p>

        ) : (

          <div className="shift-cards">

            {shifts
              .slice(0, 50)
              .map(
                renderShiftCard
              )}

          </div>

        )}

      </div>

    </div>
  )
}

export default ShiftManagement