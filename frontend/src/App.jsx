import React, { useState } from 'react';
import Dashboard from './pages/Dashboard';
import Analytics from './pages/Analytics';
import Reports from './pages/Reports';
import './App.css';
import './tailwind.css';
import LoginPage from './pages/Login';
import AdminApp from './admin/AdminApp';

// The alert email admin portal lives at /admin, completely separate from
// customer logins and pages.
const isAdminPath = () => /^\/admin(\/|$)/.test(window.location.pathname);

function App() {
  if (isAdminPath()) return <AdminApp />;
  return <CustomerApp />;
}

function CustomerApp() {
  const [currentPage, setCurrentPage] = useState('login');

  const renderPage = () => {
    switch (currentPage) {
      case 'login':
        return <LoginPage onNavigate={setCurrentPage} />;
      case 'dashboard':
        return <Dashboard onNavigate={setCurrentPage} />;
      case 'analytics':
        return <Analytics onNavigate={setCurrentPage} />;
      case 'fuel-logs':
        return <Reports onNavigate={setCurrentPage} />;
      default:
        return <Dashboard onNavigate={setCurrentPage} />;
    }
  };

  // Use a wrapper that provides navigation context to pages
  return (
    <div className="App">
      <NavigationProvider currentPage={currentPage} setCurrentPage={setCurrentPage}>
        {renderPage()}
      </NavigationProvider>
    </div>
  );
}

// Context wrapper to pass navigation to pages that need it
const NavigationContext = React.createContext();

const NavigationProvider = ({ children, currentPage, setCurrentPage }) => {
  return (
    <NavigationContext.Provider value={{ currentPage, setCurrentPage }}>
      {children}
    </NavigationContext.Provider>
  );
};

export const useNavigation = () => React.useContext(NavigationContext);
export default App;
