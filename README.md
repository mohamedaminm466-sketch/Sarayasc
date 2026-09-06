# Saraya Inventory

Full-stack coffee shop inventory and shift management application.

## Stack
- Backend: Node.js + Express + PostgreSQL
- Frontend: React + Vite
- Authentication: bcrypt + JWT

## Setup
1. Create PostgreSQL database `saraya_inventory`.
2. Run `database/schema.sql`.
3. Update `.env` with your PostgreSQL credentials and JWT secret.
4. From the project root: `npm install`
5. Start backend: `npm run dev`
6. In another terminal: `cd client && npm install && npm run dev`
7. Frontend: http://localhost:5173
8. Backend: http://localhost:5000

See the original project instructions for the default admin setup.
