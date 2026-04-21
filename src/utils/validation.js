/**
 * Utility functions for input validation
 */

/**
 * Validates if a string is a valid UUID v4 format
 * @param {string} uuid - The string to validate
 * @returns {boolean} - True if valid UUID, false otherwise
 */
function isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Middleware to validate UUID parameters
 * @param {string} paramName - The parameter name to validate (default: 'id')
 * @returns {Function} - Express middleware function
 */
function validateUUID(paramName = 'id') {
  return (req, res, next) => {
    const uuid = req.params[paramName];
    if (!isValidUUID(uuid)) {
      return res.status(404).json({ error: 'Resource not found' });
    }
    next();
  };
}

module.exports = {
  isValidUUID,
  validateUUID
};