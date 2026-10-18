# Generator Fuel Tracker Dashboard - React

A professional React dashboard for tracking generator fuel consumption and efficiency. Built with exact same UI as the original HTML/CSS version.

## Features

- **KPI Cards**: Total Fuel, Efficiency, Active Generators, Cost
- **Charts**: Fuel Trend (Line), Generator-wise Fuel (Bar)
- **Data Table**: Sortable, filterable generator performance table
- **Alerts**: Low fuel and maintenance alerts
- **Sidebar**: Navigation with ITECK logo
- **Header**: Date display, filter pills, user profile
- **Logout**: Confirmation dialog with notifications

## Technologies

- React 18
- Chart.js (with direct import, not react-chartjs-2)
- Font Awesome
- Inter Font
- CSS Variables (Design System)

## Project Structure

```
generator-fuel-dashboard-react/
├── public/
│   ├── index.html
│   └── logo.png
├── src/
│   ├── components/
│   │   ├── Layout/
│   │   │   └── Sidebar.jsx
│   │   ├── Dashboard/
│   │   │   ├── KPICards.jsx
│   │   │   ├── FuelTrendChart.jsx
│   │   │   ├── GeneratorBarChart.jsx
│   │   │   ├── DataTable.jsx
│   │   │   └── AlertsCard.jsx
│   │   └── common/
│   │       └── Header.jsx
│   ├── pages/
│   │   └── Dashboard.jsx
│   ├── App.jsx
│   ├── App.css
│   └── index.js
└── package.json
```

## Installation

```bash
cd generator-fuel-dashboard-react
npm install
```

## Running the App

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## UI Matches Original Exactly

- Same colors (Navy, Green, Amber)
- Same cards with shadows and border radius
- Same typography (Inter font)
- Same layout (Sidebar, Header, Charts, Table, Alerts)
- Same animations (fadeIn, hover effects)
- Same PKR currency
- Same ITECK logo
- Same logout button (replaced day/night toggle)

## Differences from HTML Version

| HTML/CSS | React |
|----------|-------|
| Vanilla JS | React Hooks (useState, useEffect) |
| Direct DOM manipulation | Component-based architecture |
| Inline Chart.js CDN | Imported Chart.js modules |
| Static data | State-managed data |
| File-based | Component-based structure |

## Customization

All styles are in `App.css` using CSS variables:
```css
:root {
  --navy-900: #1e3a5f;
  --green-500: #22c55e;
  --amber-500: #f59e0b;
  /* ... */
}
```

## Browser Support

- Chrome
- Firefox
- Safari
- Edge

## License

MIT
