import React from 'react';

const LogoutModal = ({ isOpen, onClose, onConfirm }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content logout-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-icon">
            <i className="fas fa-sign-out-alt"></i>
          </div>
          <h3>Log Out</h3>
        </div>
        <p className="modal-message">Are you sure you want to log out?</p>
        <div className="modal-actions">
          <button className="btn btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm}>
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
};

export default LogoutModal;
