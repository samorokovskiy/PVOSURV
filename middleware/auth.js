// middleware/auth.js

/**
 * Middleware: проверяет авторизацию пользователя
 * Если пользователь не авторизован - редирект на главную
 */
function requireAuth(req, res, next) {
    if (!req.session?.user) {
        return res.redirect('/');
    }
    next();
}

/**
 * Middleware: устанавливает данные пользователя в res.locals
 * для использования в шаблонах
 */
function setUserContext(req, res, next) {
    if (req.session?.user) {
        res.locals.user = req.session.user;
        res.locals.sessionId = req.sessionID;
    }
    next();
}

module.exports = { requireAuth, setUserContext };