import React, { createContext, useContext, useState, useEffect } from 'react';

// Create the authentication context
const AuthContext = createContext();

// Custom hook to use the auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// A session is only valid with the fleet it belongs to — every API call is
// scoped to this ID, so a missing or bad value must never fall back to another
// fleet's data.
const parseFleetId = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const clearSession = () => {
  localStorage.removeItem('user');
  localStorage.removeItem('token');
  localStorage.removeItem('fleetId');
};

// AuthProvider component to wrap the app
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [fleetId, setFleetId] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Check for existing session on mount
  useEffect(() => {
    const checkAuth = () => {
      const storedUser = localStorage.getItem('user');
      const storedToken = localStorage.getItem('token');
      const storedFleetId = parseFleetId(localStorage.getItem('fleetId'));

      if (storedUser && storedToken && storedFleetId) {
        try {
          const parsedUser = JSON.parse(storedUser);
          setUser(parsedUser);
          setToken(storedToken);
          setFleetId(storedFleetId);
          setIsAuthenticated(true);
        } catch (error) {
          console.error('Error parsing stored user:', error);
          clearSession();
        }
      } else if (storedUser || storedToken || localStorage.getItem('fleetId')) {
        // Incomplete session (e.g. no fleet) — force a fresh login
        clearSession();
      }
      
      setLoading(false);
    };

    checkAuth();
  }, []);

  // Login function
  const login = async (credentials) => {
    setIsLoading(true);
    try {
      // Replace with your actual API endpoint
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const error = await response.json();
        // Backend returns: { success: false, error: { code: "...", message: "..." } }
        const errorMessage = error.error?.message || error.message || 'Login failed';
        throw new Error(errorMessage);
      }

      const data = await response.json();

      // Debug: Log the full API response
      console.log('Login API Response:', data);

      // Extract user data and fleetId from response
      // Backend returns: { success: true, message: "...", data: { user: { fleetId: 62, username: "..." } } }
      const userData = data.data?.user || {};
      const fleetId = parseFleetId(userData.fleetId);
      if (!fleetId) {
        throw new Error('This account has no fleet assigned. Please contact the administrator.');
      }

      // Debug: Log user data fields
      console.log('User data from API:', userData);
      console.log('Available fields:', Object.keys(userData));

      // Try to find the username from various possible field names
      const possibleNameFields = ['name', 'username', 'userName', 'login', 'email', 'fullName'];
      let foundName = null;

      for (const field of possibleNameFields) {
        if (userData[field]) {
          foundName = userData[field];
          console.log(`Found name in field '${field}':`, foundName);
          break;
        }
      }

      // If name is not present, use the found name
      if (!userData.name && foundName) {
        userData.name = foundName;
      }

      // Debug: Final name value
      console.log('Final userData.name:', userData.name);

      // Store auth data (replacing anything left from a previous login)
      clearSession();
      localStorage.setItem('token', data.token || 'auth-token');
      localStorage.setItem('user', JSON.stringify(userData));
      localStorage.setItem('fleetId', String(fleetId));
      
      setUser(userData);
      setToken(data.token || 'auth-token');
      setFleetId(fleetId);
      setIsAuthenticated(true);
      
      return { success: true, user: userData, fleetId };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message };
    } finally {
      setIsLoading(false);
    }
  };

  // Logout function
  const logout = () => {
    clearSession();
    setUser(null);
    setToken(null);
    setFleetId(null);
    setIsAuthenticated(false);
  };

  // Update user profile
  const updateUser = (updatedData) => {
    const newUser = { ...user, ...updatedData };
    localStorage.setItem('user', JSON.stringify(newUser));
    setUser(newUser);
  };

  // Check if user has specific role
  const hasRole = (role) => {
    return user?.role === role;
  };

  // Check if user has permission
  const hasPermission = (permission) => {
    return user?.permissions?.includes(permission) || false;
  };

  const value = {
    user,
    token,
    fleetId,
    isAuthenticated,
    loading,
    isLoading,
    login,
    logout,
    updateUser,
    hasRole,
    hasPermission,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
