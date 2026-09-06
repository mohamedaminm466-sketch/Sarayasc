import React, { useEffect, useState } from 'react'
import { useAuth } from '../App'
import api from '../api'

const StockManagement = () => {
  const { user } = useAuth()

  const isAdmin =
    user?.role === 'admin'

  const [stock, setStock] =
    useState([])

  const [loading, setLoading] =
    useState(true)

  const [showAddForm, setShowAddForm] =
    useState(false)

  const [showCorrectForm, setShowCorrectForm] =
    useState(false)

  const [showAddItemForm, setShowAddItemForm] =
    useState(false)

  const [showStaffPrices, setShowStaffPrices] =
    useState(false)

  const [showSellingPrices, setShowSellingPrices] =
    useState(false)

  const [sellingPrices, setSellingPrices] =
    useState({})

  const [showDiscrepancyForm, setShowDiscrepancyForm] =
    useState(false)

  const [showDiscrepancies, setShowDiscrepancies] =
    useState(false)

  const [formData, setFormData] =
    useState({
      itemId: '',
      quantity: '',
      type: 'warehouse'
    })

  const [newItemData, setNewItemData] =
    useState({
      name: '',
      display_name: '',
      unit: 'unit',
      price: '',
      staff_price: '',
      is_fractional: false,
      is_tracked: true,
      can_be_front: true,
      can_be_warehouse: true
    })

  const [staffPrices, setStaffPrices] =
    useState({
      coffee: '',
      water: '',
      soda: ''
    })

  const [discrepancyData, setDiscrepancyData] =
    useState({
      itemId: '',
      expectedQuantity: '',
      actualQuantity: '',
      notes: ''
    })

  const [discrepancies, setDiscrepancies] =
    useState([])

  const [pendingCount, setPendingCount] =
    useState(0)

  const [ramiPaperStock, setRamiPaperStock] = useState(null)
  const [activeShiftId, setActiveShiftId] = useState(null)
  const [ramiPaperAddQty, setRamiPaperAddQty] = useState('')
  const [ramiPaperLoading, setRamiPaperLoading] = useState(false)
  const [chichaPriceSetting, setChichaPriceSetting] = useState(0)

  const [message, setMessage] =
    useState({
      type: '',
      text: ''
    })

  /*
  ============================================================
  FETCH
  ============================================================
  */

  useEffect(() => {
    fetchStock()
    
    if (isAdmin) {
      fetchPendingDiscrepanciesCount()
      
      const interval = setInterval(fetchPendingDiscrepanciesCount, 10000)
      
      return () => clearInterval(interval)
    }
  }, [isAdmin])

  const fetchStock = async () => {

    try {

      const response =
        await api.get('/stock')

      setStock(
        response.data
      )

      const priceMap = {}
      response.data.forEach(item => { priceMap[item.id] = item.price ?? '' })
      setSellingPrices(priceMap)

      try {
        const ramiRes = await api.get('/shifts/rami-paper')
        setRamiPaperStock(ramiRes.data)
      } catch (err) { console.warn('Failed to fetch Rami paper stock:', err) }
      if (isAdmin) {
        try { const settingsRes = await api.get('/stock/settings'); setChichaPriceSetting(Number(settingsRes.data?.chicha_price) || 0) } catch (err) {}
      }
      try {
        const activeRes = await api.get('/shifts/active')
        setActiveShiftId(activeRes.data?.active ? activeRes.data.shift?.id : null)
        if (activeRes.data?.shift?.ramiPaperStock) setRamiPaperStock(activeRes.data.shift.ramiPaperStock)
      } catch (err) { console.warn('Failed to fetch active shift:', err) }

      // Fetch staff prices from database
      try {
        const staffPricesRes = await api.get('/stock/staff-prices')
        if (staffPricesRes.data) {
          setStaffPrices({
            coffee: staffPricesRes.data.coffee || '',
            water: staffPricesRes.data.water || '',
            soda: staffPricesRes.data.soda || ''
          })
        }
      } catch (err) {
        console.error('Failed to fetch staff prices:', err)
      }

    } catch (error) {

      console.error(
        'Failed to fetch stock:',
        error
      )

    } finally {

      setLoading(false)
    }
  }

  /*
  ============================================================
  FETCH DISCREPANCIES (ADMIN ONLY)
  ============================================================
  */

  const fetchDiscrepancies = async () => {
    if (!isAdmin) return
    try {
      const response = await api.get('/stock/discrepancies')
      setDiscrepancies(response.data)
      const pending = response.data.filter(d => d.status === 'pending').length
      setPendingCount(pending)
    } catch (error) {
      console.error('Failed to fetch discrepancies:', error)
    }
  }

  /*
  ============================================================
  FETCH PENDING DISCREPANCIES COUNT
  ============================================================
  */

  const fetchPendingDiscrepanciesCount = async () => {
    if (!isAdmin) return
    
    try {
      const response = await api.get('/stock/discrepancies')
      const pending = response.data.filter(d => d.status === 'pending').length
      setPendingCount(pending)
    } catch (error) {
      console.error('Failed to fetch discrepancies count:', error)
    }
  }

  /*
  ============================================================
  VISIBILITY
  ============================================================
  */

  const toggleVisibility =
    async (
      itemId,
      visible
    ) => {

      try {

        await api.put(
          `/stock/items/${itemId}/visibility`,
          {
            visible_to_workers:
              visible
          }
        )

        await fetchStock()

        setMessage({
          type: 'success',
          text:
            `Item ${
              visible
                ? 'visible'
                : 'hidden'
            } to workers.`
        })

      } catch (error) {

        setMessage({
          type: 'error',
          text:
            error.response?.data?.error ||
            'Failed to update visibility'
        })
      }
    }

  /*
  ============================================================
  DELETE ITEM
  ============================================================
  */

  const handleDeleteItem =
    async (itemId, itemName) => {

      if (!window.confirm(`Are you sure you want to delete "${itemName}"? This action cannot be undone.`)) {
        return
      }

      try {

        await api.delete(`/stock/items/${itemId}`)

        await fetchStock()

        setMessage({
          type: 'success',
          text: `Item "${itemName}" deleted successfully.`
        })

      } catch (error) {

        setMessage({
          type: 'error',
          text:
            error.response?.data?.error ||
            'Failed to delete item'
        })
      }
    }

  const handleSaveSellingPrice = async item => {
    try {
      await api.put(`/stock/items/${item.id}/price`, {
        price: parseFloat(sellingPrices[item.id]) || 0
      })
      await fetchStock()
      setMessage({ type: 'success', text: `Selling price updated for ${item.display_name || item.name}.` })
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || 'Failed to update selling price' })
    }
  }

  /*
  ============================================================
  STAFF PRICES
  ============================================================
  */

  const handleSaveStaffPrices =
    async e => {

      e.preventDefault()

      try {

        await api.put(
          '/stock/staff-prices',
          {
            coffee:
              parseFloat(
                staffPrices.coffee
              ) || 0,

            water:
              parseFloat(
                staffPrices.water
              ) || 0,

            soda:
              parseFloat(
                staffPrices.soda
              ) || 0
          }
        )

        await fetchStock()

        setMessage({
          type: 'success',
          text:
            'Staff prices updated successfully.'
        })

      } catch (error) {

        setMessage({
          type: 'error',
          text:
            error.response?.data?.error ||
            'Failed to update staff prices'
        })
      }
    }

  /*
  ============================================================
  ADD SUPPLIER STOCK
  ============================================================
  */

  const handleAddSupplierStock =
    async e => {

      e.preventDefault()

      if (
        !formData.itemId ||
        !formData.quantity ||
        parseFloat(
          formData.quantity
        ) <= 0
      ) {

        setMessage({
          type: 'error',
          text:
            'Please select an item and enter a valid quantity.'
        })

        return
      }

      try {

        const response =
          await api.post(
            '/stock/add-supplier',
            {
              additions: [
                {
                  itemId:
                    formData.itemId,

                  quantity:
                    parseFloat(
                      formData.quantity
                    )
                }
              ]
            }
          )

        setStock(
          Array.isArray(response.data) ? response.data : (response.data.stock || [])
        )

        setShowAddForm(false)

        setFormData({
          itemId: '',
          quantity: '',
          type: 'warehouse'
        })

        setMessage({
          type: 'success',
          text:
            'Stock added successfully.'
        })

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
  MANUAL CORRECTION
  ============================================================
  */

  const handleCorrectStock =
    async e => {

      e.preventDefault()

      if (
        !formData.itemId ||
        formData.quantity === ''
      ) {

        setMessage({
          type: 'error',
          text:
            'Please select an item and enter a quantity.'
        })

        return
      }

      try {

        const response =
          await api.post(
            '/stock/correct',
            {
              corrections: [
                {
                  itemId:
                    formData.itemId,

                  quantity:
                    parseFloat(
                      formData.quantity
                    ),

                  type:
                    formData.type
                }
              ]
            }
          )

        setStock(
          Array.isArray(response.data) ? response.data : (response.data.stock || [])
        )

        setShowCorrectForm(false)

        setFormData({
          itemId: '',
          quantity: '',
          type: 'warehouse'
        })

        setMessage({
          type: 'success',
          text:
            'Stock corrected successfully.'
        })

      } catch (error) {

        setMessage({
          type: 'error',
          text:
            error.response?.data?.error ||
            'Failed to correct stock'
        })
      }
    }

  /*
  ============================================================
  REPORT DISCREPANCY (WORKER)
  ============================================================
  */

  const handleReportDiscrepancy =
    async e => {

      e.preventDefault()

      if (
        !discrepancyData.itemId ||
        !discrepancyData.expectedQuantity ||
        !discrepancyData.actualQuantity
      ) {

        setMessage({
          type: 'error',
          text:
            'Please fill all required fields.'
        })

        return
      }

      try {

        await api.post(
          '/stock/discrepancy',
          {
            itemId:
              discrepancyData.itemId,

            expectedQuantity:
              parseFloat(
                discrepancyData.expectedQuantity
              ),

            actualQuantity:
              parseFloat(
                discrepancyData.actualQuantity
              ),

            notes:
              discrepancyData.notes || ''
          }
        )

        setShowDiscrepancyForm(false)

        setDiscrepancyData({
          itemId: '',
          expectedQuantity: '',
          actualQuantity: '',
          notes: ''
        })

        setMessage({
          type: 'success',
          text:
            '✅ Discrepancy reported successfully! Admin will review it.'
        })

        if (isAdmin) {
          await fetchPendingDiscrepanciesCount()
        }

      } catch (error) {

        setMessage({
          type: 'error',
          text:
            error.response?.data?.error ||
            'Failed to report discrepancy'
        })
      }
    }

  /*
  ============================================================
  RESOLVE DISCREPANCY (ADMIN)
  ============================================================
  */

  const handleResolveDiscrepancy =
    async (id) => {

      try {

        await api.put(
          `/stock/discrepancies/${id}/resolve`
        )

        await fetchDiscrepancies()
        await fetchPendingDiscrepanciesCount()

        setMessage({
          type: 'success',
          text:
            '✅ Discrepancy resolved successfully.'
        })

        if (pendingCount === 1) {
          setMessage({
            type: 'success',
            text: '✅ All discrepancies resolved! 🎉'
          })
        }

      } catch (error) {

        setMessage({
          type: 'success',
          text: 'Stock correction applied successfully.'
        })
      }
    }

  /*
  ============================================================
  ADD ITEM
  ============================================================
  */

  const handleAddNewItem =
    async e => {

      e.preventDefault()

      if (
        !newItemData.name ||
        !newItemData.display_name
      ) {

        setMessage({
          type: 'error',
          text:
            'Item name and display name are required.'
        })

        return
      }

      try {

        await api.post(
          '/stock/items',
          newItemData
        )

        await fetchStock()

        setShowAddItemForm(false)

        setNewItemData({
          name: '',
          display_name: '',
          unit: 'unit',
          price: '',
          staff_price: '',
          is_fractional: false,
          is_tracked: true,
          can_be_front: true,
          can_be_warehouse: true
        })

        setMessage({
          type: 'success',
          text:
            'New item added successfully.'
        })

      } catch (error) {

        setMessage({
          type: 'error',
          text:
            error.response?.data?.error ||
            'Failed to add item'
        })
      }
    }

  /*
  ============================================================
  LOADING
  ============================================================
  */

  if (loading) {
    return (
      <div className="loading-screen">
        Loading stock...
      </div>
    )
  }


  const handleAddRamiPaper = async () => {
    const quantity = Math.trunc(Number(ramiPaperAddQty))
    if (!activeShiftId || !Number.isFinite(quantity) || quantity <= 0) {
      setMessage({ type: 'error', text: activeShiftId ? 'Enter a positive quantity.' : 'Start a shift before adding Rami paper.' })
      return
    }
    try {
      setRamiPaperLoading(true)
      const response = await api.post('/shifts/rami-paper/add', {
        shiftId: activeShiftId,
        quantity
      })
      setRamiPaperStock(response.data)
      setRamiPaperAddQty('')
      setMessage({ type: 'success', text: `✅ ${quantity} papier(s) Rami ajouté(s).` })
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || 'Failed to add Rami paper.' })
    } finally {
      setRamiPaperLoading(false)
    }
  }

  /*
  ============================================================
  RENDER
  ============================================================
  */

  return (
    <div className="stock-management">

      <div className="page-header">

        <h1>
          Stock Management
        </h1>

        <div className="header-actions">

          {!isAdmin && (
            <button
              onClick={() => {
                setShowDiscrepancyForm(!showDiscrepancyForm)
                if (showDiscrepancyForm) {
                  setDiscrepancyData({
                    itemId: '',
                    expectedQuantity: '',
                    actualQuantity: '',
                    notes: ''
                  })
                }
              }}
              className="btn btn-warning"
            >
              ⚠️ Report Stock Issue
            </button>
          )}

          {isAdmin && (
            <>
              <button
                onClick={() => {
                  setShowDiscrepancies(!showDiscrepancies)
                  if (!showDiscrepancies) {
                    fetchDiscrepancies()
                    fetchPendingDiscrepanciesCount()
                  }
                }}
                className="btn btn-info"
                style={{ position: 'relative' }}
              >
                📋 Discrepancies
                {pendingCount > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: '-8px',
                    right: '-8px',
                    background: '#dc3545',
                    color: 'white',
                    borderRadius: '50%',
                    padding: '2px 8px',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    animation: 'pulse 2s infinite'
                  }}>
                    {pendingCount}
                  </span>
                )}
              </button>

              <button
                onClick={() =>
                  setShowStaffPrices(
                    !showStaffPrices
                  )
                }
                className="btn btn-success"
              >
                💰 Staff Prices
              </button>

              <button
                onClick={() =>
                  setShowAddItemForm(
                    !showAddItemForm
                  )
                }
                className="btn btn-success"
              >
                ➕ Add New Item
              </button>

              <button
                onClick={() =>
                  setShowAddForm(
                    !showAddForm
                  )
                }
                className="btn btn-primary"
              >
                📦 Add Supplier Stock
              </button>

              <button
                onClick={() =>
                  setShowCorrectForm(
                    !showCorrectForm
                  )
                }
                className="btn btn-warning"
              >
                ✏️ Manual Correction
              </button>
            </>
          )}

        </div>
      </div>

      {message.text && (
        <div
          className={`alert alert-${message.type}`}
          style={{
            animation: 'slideDown 0.3s ease-out'
          }}
        >
          {message.text}
        </div>
      )}

      {/*
      ========================================================
      DISCREPANCY REPORT FORM - WORKER
      ========================================================
      */}

      <div className="form-card" style={{ marginBottom: '15px' }}>
        <h3>📄 Papier Rami</h3>
        <p className="form-hint">
          Stock séparé du dépôt : les travailleurs peuvent ajouter le papier directement au café.
        </p>
        <div style={{ display:'flex', gap:'12px', alignItems:'end', flexWrap:'wrap' }}>
          <div>
            <strong>Restant au café : {Number(ramiPaperStock?.quantity ?? 0)}</strong>
            {ramiPaperStock?.last_added_at && (
              <div style={{ fontSize:'0.85rem', color:'#666', marginTop:'5px' }}>
                Dernier ajout : {new Date(ramiPaperStock.last_added_at).toLocaleString()}
                {ramiPaperStock.last_added_by_username ? ` — ${ramiPaperStock.last_added_by_username}` : ''}
              </div>
            )}
          </div>
          {!isAdmin && (
            <>
              <div className="form-group" style={{ margin:0 }}>
                <label>Ajouter papier</label>
                <input type="number" min="1" step="1" value={ramiPaperAddQty} onChange={e => setRamiPaperAddQty(e.target.value)} placeholder="Quantité" />
              </div>
              <button type="button" className="btn btn-primary" onClick={handleAddRamiPaper} disabled={ramiPaperLoading}>
                ➕ Ajouter papier Rami
              </button>
            </>
          )}
        </div>
      </div>

      {showDiscrepancyForm && !isAdmin && (
        <div className="form-card">

          <h3>
            ⚠️ Report Stock Discrepancy
          </h3>

          <p className="form-hint">
            If the stock in the warehouse doesn't match what you see,
            report it here for the admin to review.
          </p>

          <form
            onSubmit={
              handleReportDiscrepancy
            }
          >

            <div className="form-group">

              <label>
                Item
              </label>

              <select
                value={
                  discrepancyData.itemId
                }
                onChange={e => {
                  const selectedItem = stock.find(item => item.id === parseInt(e.target.value))
                  setDiscrepancyData({
                    ...discrepancyData,
                    itemId: e.target.value,
                    expectedQuantity: selectedItem ? selectedItem.warehouse_quantity : '',
                    actualQuantity: ''
                  })
                }}
                required
              >

                <option value="">
                  Select item
                </option>

                {stock.map(item => (

                  <option
                    key={item.id}
                    value={item.id}
                  >
                    {item.display_name} (System: {item.warehouse_quantity} {item.unit})
                  </option>

                ))}

              </select>

            </div>

            <div className="form-group">

              <label>
                Expected Quantity (as per system)
              </label>

              <input
                type="number"
                step="0.01"
                min="0"
                value={
                  discrepancyData.expectedQuantity
                }
                onChange={e =>
                  setDiscrepancyData({
                    ...discrepancyData,
                    expectedQuantity:
                      e.target.value
                  })
                }
                required
                style={{ backgroundColor: '#f0f0f0' }}
              />
              <small style={{ color: '#666' }}>
                This is the quantity in the system (auto-filled)
              </small>

            </div>

            <div className="form-group">

              <label>
                Actual Quantity (what you see in the warehouse)
              </label>

              <input
                type="number"
                step="0.01"
                min="0"
                value={
                  discrepancyData.actualQuantity
                }
                onChange={e =>
                  setDiscrepancyData({
                    ...discrepancyData,
                    actualQuantity:
                      e.target.value
                  })
                }
                required
                placeholder="Enter the actual quantity you counted"
                style={{ borderColor: '#f39c12' }}
              />
              <small style={{ color: '#e67e22' }}>
                Enter what you actually counted in the warehouse
              </small>

            </div>

            {discrepancyData.expectedQuantity && discrepancyData.actualQuantity && (
              <div style={{
                padding: '12px',
                margin: '10px 0',
                background: parseFloat(discrepancyData.expectedQuantity) !== parseFloat(discrepancyData.actualQuantity)
                  ? '#fff3cd'
                  : '#d4edda',
                borderRadius: '8px',
                border: `1px solid ${parseFloat(discrepancyData.expectedQuantity) !== parseFloat(discrepancyData.actualQuantity)
                  ? '#ffc107'
                  : '#28a745'}`
              }}>
                <strong>Difference:</strong>{' '}
                {parseFloat(discrepancyData.expectedQuantity) !== parseFloat(discrepancyData.actualQuantity) ? (
                  <span style={{ color: '#dc3545' }}>
                    ⚠️ Difference of {(parseFloat(discrepancyData.expectedQuantity) - parseFloat(discrepancyData.actualQuantity)).toFixed(2)} units
                  </span>
                ) : (
                  <span style={{ color: '#28a745' }}>✅ Quantities match</span>
                )}
              </div>
            )}

            <div className="form-group">

              <label>
                Notes (optional)
              </label>

              <textarea
                rows="2"
                value={
                  discrepancyData.notes
                }
                onChange={e =>
                  setDiscrepancyData({
                    ...discrepancyData,
                    notes:
                      e.target.value
                  })
                }
                placeholder="Any additional details about the discrepancy..."
              />

            </div>

            <div className="form-actions">

              <button
                type="submit"
                className="btn btn-warning"
                disabled={!discrepancyData.itemId || !discrepancyData.expectedQuantity || !discrepancyData.actualQuantity}
              >
                ⚠️ Report Discrepancy
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowDiscrepancyForm(false)
                  setDiscrepancyData({
                    itemId: '',
                    expectedQuantity: '',
                    actualQuantity: '',
                    notes: ''
                  })
                }}
              >
                Cancel
              </button>

            </div>

          </form>

        </div>
      )}

      {/*
      ========================================================
      DISCREPANCIES LIST - ADMIN
      ========================================================
      */}

      {showDiscrepancies && isAdmin && (
        <div className="form-card">

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >

            <h3>
              📋 Stock Discrepancies Reports
            </h3>

            <div>
              <span style={{ marginRight: '15px' }}>
                🟡 Pending: {discrepancies.filter(d => d.status === 'pending').length}
              </span>
              <span style={{ marginRight: '15px', color: '#28a745' }}>
                ✅ Resolved: {discrepancies.filter(d => d.status === 'resolved').length}
              </span>
              <button
                className="btn btn-secondary"
                onClick={() =>
                  setShowDiscrepancies(false)
                }
              >
                Close
              </button>
            </div>

          </div>

          {discrepancies.length === 0 ? (

            <p className="empty-state">
              No discrepancies reported.
            </p>

          ) : (

            <div className="stock-table-container">

              <table className="stock-table">

                <thead>

                  <tr>

                    <th>
                      Item
                    </th>

                    <th>
                      System Qty
                    </th>

                    <th>
                      Actual Qty
                    </th>

                    <th>
                      Difference
                    </th>

                    <th>
                      Reported By
                    </th>

                    <th>
                      Date
                    </th>

                    <th>
                      Notes
                    </th>

                    <th>
                      Status
                    </th>

                    <th>
                      Actions
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {discrepancies.map(d => (

                    <tr
                      key={d.id}
                      style={{
                        background: d.status === 'pending' ? '#fff3cd' : 'transparent'
                      }}
                    >

                      <td>
                        <strong>{d.item_name}</strong>
                      </td>

                      <td>
                        {d.expected_quantity}
                      </td>

                      <td style={{ color: '#e67e22', fontWeight: 'bold' }}>
                        {d.actual_quantity}
                      </td>

                      <td style={{
                        color: (d.expected_quantity - d.actual_quantity) !== 0 ? '#dc3545' : '#28a745',
                        fontWeight: 'bold'
                      }}>
                        {(d.expected_quantity - d.actual_quantity).toFixed(2)}
                      </td>

                      <td>
                        {d.reported_by_name}
                      </td>

                      <td>
                        {new Date(d.created_at).toLocaleString()}
                      </td>

                      <td>
                        {d.notes && (
                          <span title={d.notes} style={{ cursor: 'help' }}>
                            📝 {d.notes.length > 20 ? d.notes.substring(0, 20) + '...' : d.notes}
                          </span>
                        )}
                      </td>

                      <td>
                        <span className={`status-badge ${d.status}`}>
                          {d.status === 'pending' ? '🟡 Pending' : '✅ Resolved'}
                        </span>
                      </td>

                      <td>

                        {d.status === 'pending' && (
                          <button
                            onClick={() => {
                              if (window.confirm('Resolve this discrepancy?')) {
                                handleResolveDiscrepancy(d.id)
                              }
                            }}
                            className="btn btn-sm btn-success"
                          >
                            ✅ Resolve
                          </button>
                        )}

                      </td>

                    </tr>

                  ))}

                </tbody>

              </table>

            </div>

          )}

        </div>
      )}

      {/* SELLING PRICES - ADMIN */}
      {isAdmin && (
        <div style={{ margin: '12px 0' }}>
          <button className="btn btn-primary" onClick={() => setShowSellingPrices(!showSellingPrices)}>
            💲 {showSellingPrices ? 'Hide' : 'Manage'} Selling Prices
          </button>
        </div>
      )}

      {showSellingPrices && isAdmin && (
        <div className="form-card">
          <h3>💲 Product Selling Prices</h3>
          <p className="form-hint">Set the prices used by the shift discrepancy calculator. Configure EAU 0.5, EAU 1L, EAU 1.5L, Gazeuses, Cannette and Chicha here.</p>
          {stock.map(item => (
            <div className="form-row" key={`price-${item.id}`}>
              <label>{item.display_name || item.name}</label>
              <input type="number" min="0" step="0.01"
                value={sellingPrices[item.id] ?? ''}
                onChange={e => setSellingPrices({ ...sellingPrices, [item.id]: e.target.value })} />
              <button type="button" className="btn btn-success" onClick={() => handleSaveSellingPrice(item)}>Save</button>
            </div>
          ))}
        </div>
      )}

      {isAdmin && (
        <div className="form-card">
          <h3>🌿 Prix Chicha</h3>
          <p className="form-hint">Le prix utilisé dans le classificateur Chicha / Eau 0.5 pendant la clôture.</p>
          <div className="form-row"><label>Prix Chicha (DT)</label><input type="number" min="0" step="0.01" value={chichaPriceSetting} onChange={e=>setChichaPriceSetting(e.target.value)} /><button type="button" className="btn btn-success" onClick={async()=>{try{const price=parseFloat(chichaPriceSetting)||0;await api.put('/stock/settings/chicha-price',{price});setChichaPriceSetting(price);setMessage({type:'success',text:'Prix Chicha enregistré.'})}catch(e){setMessage({type:'error',text:e.response?.data?.error||'Impossible de sauvegarder le prix Chicha.'})}}}>Save</button></div>
        </div>
      )}

      {/*
      ========================================================
      STAFF PRICES
      ========================================================
      */}

      {showStaffPrices &&
        isAdmin && (
          <div className="form-card">

            <h3>
              💰 Staff Prices
            </h3>

            <p className="form-hint">
              These prices are used when calculating
              staff consumption at the end of a shift.
            </p>

            <form
              onSubmit={
                handleSaveStaffPrices
              }
            >

              <div className="form-row">

                <label>
                  Staff Coffee Price (DT)
                </label>

                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={
                    staffPrices.coffee
                  }
                  onChange={e =>
                    setStaffPrices({
                      ...staffPrices,
                      coffee:
                        e.target.value
                    })
                  }
                />

              </div>

              <div className="form-row">

                <label>
                  Staff Water Price (DT)
                </label>

                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={
                    staffPrices.water
                  }
                  onChange={e =>
                    setStaffPrices({
                      ...staffPrices,
                      water:
                        e.target.value
                    })
                  }
                />

              </div>

              <div className="form-row">

                <label>
                  Staff Gazeuses Price (DT)
                </label>

                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={
                    staffPrices.soda
                  }
                  onChange={e =>
                    setStaffPrices({
                      ...staffPrices,
                      soda:
                        e.target.value
                    })
                  }
                />

              </div>

              <div className="form-actions">

                <button
                  type="submit"
                  className="btn btn-success"
                >
                  💾 Save Staff Prices
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    setShowStaffPrices(
                      false
                    )
                  }
                >
                  Cancel
                </button>

              </div>

            </form>
          </div>
        )}

      {/*
      ========================================================
      ADD ITEM
      ========================================================
      */}

      {showAddItemForm &&
        isAdmin && (
          <div className="form-card">

            <h3>
              Add New Item
            </h3>

            <form
              onSubmit={
                handleAddNewItem
              }
            >

              <div className="form-row">

                <label>
                  Item Name
                </label>

                <input
                  type="text"
                  value={
                    newItemData.name
                  }
                  onChange={e =>
                    setNewItemData({
                      ...newItemData,
                      name:
                        e.target.value
                          .toLowerCase()
                          .replace(
                            / /g,
                            '_'
                          )
                    })
                  }
                  required
                />

              </div>

              <div className="form-row">

                <label>
                  Display Name
                </label>

                <input
                  type="text"
                  value={
                    newItemData.display_name
                  }
                  onChange={e =>
                    setNewItemData({
                      ...newItemData,
                      display_name:
                        e.target.value
                    })
                  }
                  required
                />

              </div>

              <div className="form-row">

                <label>
                  Unit
                </label>

                <input
                  type="text"
                  value={
                    newItemData.unit
                  }
                  onChange={e =>
                    setNewItemData({
                      ...newItemData,
                      unit:
                        e.target.value
                    })
                  }
                />

              </div>

              <div className="form-row">

                <label>
                  Price (DT)
                </label>

                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={
                    newItemData.price
                  }
                  onChange={e =>
                    setNewItemData({
                      ...newItemData,
                      price:
                        e.target.value
                    })
                  }
                />

              </div>

              <div className="form-row">

                <label>
                  Staff Price (DT)
                </label>

                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={
                    newItemData.staff_price
                  }
                  onChange={e =>
                    setNewItemData({
                      ...newItemData,
                      staff_price:
                        e.target.value
                    })
                  }
                />

              </div>

              <div className="form-row">

                <label>

                  <input
                    type="checkbox"
                    checked={
                      newItemData.is_fractional
                    }
                    onChange={e =>
                      setNewItemData({
                        ...newItemData,
                        is_fractional:
                          e.target.checked
                      })
                    }
                  />

                  {' '}
                  Fractional unit

                </label>

              </div>

              <div style={{
                padding: '15px',
                margin: '10px 0',
                background: '#f8f9fa',
                borderRadius: '8px',
                border: '1px solid #dee2e6'
              }}>

                <h4 style={{ marginTop: '0' }}>
                  📍 Stock Location Settings
                </h4>

                <div className="form-row">

                  <label>

                    <input
                      type="checkbox"
                      checked={
                        newItemData.can_be_front
                      }
                      onChange={e =>
                        setNewItemData({
                          ...newItemData,
                          can_be_front:
                            e.target.checked
                        })
                      }
                    />

                    {' '}
                    Can be stored in Front (counter) — optional

                  </label>

                </div>

                <div className="form-row">

                  <label>

                    <input
                      type="checkbox"
                      checked={
                        newItemData.can_be_warehouse
                      }
                      onChange={e =>
                        setNewItemData({
                          ...newItemData,
                          can_be_warehouse:
                            e.target.checked
                        })
                      }
                    />

                    {' '}
                    Can be stored in Warehouse — default YES

                  </label>

                </div>

                <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '10px' }}>
                  💡 Uncheck locations where this item cannot be stored.
                  For example: charbon, citron, manga - only warehouse.
                  Products like coffee, water - both front and warehouse.
                </p>

              </div>

              <div className="form-actions">

                <button
                  type="submit"
                  className="btn btn-success"
                >
                  Add Item
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    setShowAddItemForm(
                      false
                    )
                  }
                >
                  Cancel
                </button>

              </div>

            </form>
          </div>
        )}

      {/*
      ========================================================
      ADD SUPPLIER STOCK
      ========================================================
      */}

      {showAddForm &&
        isAdmin && (
          <div className="form-card">

            <h3>
              Add Stock from Supplier
            </h3>

            <form
              onSubmit={
                handleAddSupplierStock
              }
            >

              <div className="form-group">

                <label>
                  Item
                </label>

                <select
                  value={
                    formData.itemId
                  }
                  onChange={e =>
                    setFormData({
                      ...formData,
                      itemId:
                        e.target.value
                    })
                  }
                  required
                >

                  <option value="">
                    Select item
                  </option>

                  {stock.filter(item => item.can_be_warehouse !== false).map(item => (
                    <option
                      key={item.id}
                      value={item.id}
                    >
                      {item.display_name}
                      {' '}
                      (
                      {item.warehouse_quantity}
                      {' '}
                      {item.unit}
                      )
                    </option>
                  ))}

                </select>

              </div>

              <div className="form-group">

                <label>
                  Quantity
                </label>

                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={
                    formData.quantity
                  }
                  onChange={e =>
                    setFormData({
                      ...formData,
                      quantity:
                        e.target.value
                    })
                  }
                  required
                />

              </div>

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
                    setShowAddForm(
                      false
                    )
                  }
                >
                  Cancel
                </button>

              </div>

            </form>
          </div>
        )}

      {/*
      ========================================================
      CORRECTION
      ========================================================
      */}

      {showCorrectForm &&
        isAdmin && (
          <div className="form-card">

            <h3>
              Manual Stock Correction
            </h3>

            <p className="form-hint">
              Positive = add.
              Negative = subtract.
            </p>

            <form
              onSubmit={
                handleCorrectStock
              }
            >

              <div className="form-group">

                <label>
                  Item
                </label>

                <select
                  value={
                    formData.itemId
                  }
                  onChange={e =>
                    setFormData({
                      ...formData,
                      itemId:
                        e.target.value
                    })
                  }
                  required
                >

                  <option value="">
                    Select item
                  </option>

                  {stock.map(item => (
                    <option
                      key={item.id}
                      value={item.id}
                    >
                      {item.display_name}
                      {' '}
                      (W:
                      {item.warehouse_quantity}
                      , F:
                      {item.front_quantity}
                      )
                      {!item.can_be_front && ' 🔒No Front'}
                      {!item.can_be_warehouse && ' 🔒No Warehouse'}
                    </option>
                  ))}

                </select>

              </div>

              <div className="form-group">

                <label>
                  Stock Type
                </label>

                <select
                  value={
                    formData.type
                  }
                  onChange={e =>
                    setFormData({
                      ...formData,
                      type:
                        e.target.value
                    })
                  }
                >

                  <option value="warehouse">
                    Warehouse
                  </option>

                  <option value="front">
                    Front
                  </option>

                </select>

              </div>

              <div className="form-group">

                <label>
                  Quantity
                </label>

                <input
                  type="number"
                  step="0.01"
                  value={
                    formData.quantity
                  }
                  onChange={e =>
                    setFormData({
                      ...formData,
                      quantity:
                        e.target.value
                    })
                  }
                  required
                />

              </div>

              <div className="form-actions">

                <button
                  type="submit"
                  className="btn btn-warning"
                >
                  Apply Correction
                </button>

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() =>
                    setShowCorrectForm(
                      false
                    )
                  }
                >
                  Cancel
                </button>

              </div>

            </form>
          </div>
        )}

      {/*
      ========================================================
      STOCK TABLE
      ========================================================
      */}

      <div className="stock-table-container">

        <table className="stock-table">

          <thead>

            <tr>

              <th>
                Item
              </th>

              <th>
                Unit
              </th>

              <th>
                Warehouse
              </th>

              <th>
                Front
              </th>

              <th>
                Total
              </th>

              <th>
                Price
              </th>

              <th>
                Value
              </th>

              {isAdmin && (
                <>
                  <th>
                    Locations
                  </th>
                  <th>
                    Visibility
                  </th>
                  <th>
                    Actions
                  </th>
                </>
              )}

            </tr>

          </thead>

          <tbody>

            {stock.length === 0 ? (

              <tr>

                <td
                  colSpan={
                    isAdmin
                      ? 10
                      : 7
                  }
                  style={{
                    textAlign:
                      'center',
                    padding:
                      '40px'
                  }}
                >
                  No items in stock.
                </td>

              </tr>

            ) : (

              stock.map(item => {

                const warehouse =
                  parseFloat(
                    item.warehouse_quantity
                  ) || 0

                const front =
                  parseFloat(
                    item.front_quantity
                  ) || 0

                const total =
                  warehouse +
                  front

                const price =
                  parseFloat(
                    item.price
                  ) || 0

                const value =
                  price *
                  total

                const isLow =
                  warehouse < 5

                // Determine location status
                const canFront = item.can_be_front !== false
                const canWarehouse = item.can_be_warehouse !== false

                return (

                  <tr
                    key={item.id}
                    className={
                      isLow
                        ? 'low-stock-row'
                        : ''
                    }
                    style={{
                      backgroundColor: !canFront || !canWarehouse ? '#fff8e1' : 'transparent'
                    }}
                  >

                    <td className="item-name-cell">

                      <span className="item-name">
                        {
                          item.display_name ||
                          item.name
                        }
                      </span>

                      <span className="item-unit">
                        {item.name}
                      </span>

                      {(!canFront || !canWarehouse) && (
                        <span style={{
                          fontSize: '0.7rem',
                          color: '#e67e22',
                          display: 'block'
                        }}>
                          {!canWarehouse && '🏚️ No Warehouse '}
                          {!canFront && '🏪 No Front'}
                        </span>
                      )}

                    </td>

                    <td>
                      {
                        item.unit ||
                        'unit'
                      }
                    </td>

                    <td
                      className={
                        isLow
                          ? 'warning'
                          : ''
                      }
                    >
                      {canWarehouse ? warehouse.toFixed(2) : '🚫'}

                      {isLow && canWarehouse && (
                        <span className="low-badge">
                          ⚠️ Low
                        </span>
                      )}

                    </td>

                    <td>
                      {canFront ? front.toFixed(2) : '🚫'}
                    </td>

                    <td>
                      {total.toFixed(2)}
                    </td>

                    <td>
                      {price > 0
                        ? `${price.toFixed(2)} DT`
                        : '-'}
                    </td>

                    <td>
                      {price > 0
                        ? `${value.toFixed(2)} DT`
                        : '-'}
                    </td>

                    {isAdmin && (
                      <>
                        <td style={{ fontSize: '0.8rem' }}>
                          {canWarehouse ? '🏚️' : '🚫'} 
                          {canFront ? '🏪' : '🚫'}
                        </td>

                        <td>

                          <button
                            onClick={() =>
                              toggleVisibility(
                                item.id,
                                !item.visible_to_workers
                              )
                            }
                            className="btn btn-sm btn-secondary"
                            style={{
                              fontSize:
                                '1.2rem',
                              padding:
                                '4px 8px'
                            }}
                            title={
                              item.visible_to_workers !== false
                                ? 'Visible to workers'
                                : 'Hidden from workers'
                            }
                          >
                            {
                              item.visible_to_workers !== false
                                ? '👁️'
                                : '🚫'
                            }
                          </button>

                        </td>

                        <td>

                          <button
                            onClick={() =>
                              handleDeleteItem(
                                item.id,
                                item.display_name || item.name
                              )
                            }
                            className="btn btn-sm btn-danger"
                            style={{
                              fontSize:
                                '1rem',
                              padding:
                                '4px 8px'
                            }}
                            title="Delete item"
                          >
                            🗑️
                          </button>

                        </td>
                      </>
                    )}

                  </tr>
                )
              })

            )}

          </tbody>

        </table>

      </div>

    </div>
  )
}

export default StockManagement