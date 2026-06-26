// routes/apiRoutes.js
const oracledb = require('oracledb');
const { getConnectionForSession } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

// Импортируем connectionManager из authRoutes
const { connectionManager } = require('./authRoutes');

module.exports = function(app) {

    // ============================================
    // API: ИНФОРМАЦИЯ О ПОЛЬЗОВАТЕЛЕ
    // ============================================

    app.get('/api/userinfo', requireAuth, (req, res) => {
        res.json({
            username: req.session.user || 'неизвестный',
            sessionId: req.sessionID,
            lastActivity: req.session.lastActivity
        });
    });

    // ============================================
    // API: ВЫПОЛНЕНИЕ ЗАПРОСА К ПРЕДСТАВЛЕНИЮ
    // ============================================

    app.post('/api/query', requireAuth, async (req, res) => {
        const { sql } = req.body;

        if (!sql || !sql.trim()) {
            return res.status(400).json({ success: false, error: 'SQL-запрос не может быть пустым' });
        }

        // Базовая защита: запрещаем DDL-команды
        const upperSql = sql.toUpperCase().trim();
        const dangerousKeywords = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE', 'MERGE'];
        if (dangerousKeywords.some(keyword => upperSql.includes(keyword))) {
            return res.status(403).json({ success: false, error: 'Запрещенные операции с данными' });
        }

        try {
            const connection = await getConnectionForSession(req, connectionManager);

            const result = await connection.execute(
                sql,
                [],
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            res.json({ success: true, data: result.rows });

        } catch (err) {
            console.error('❌ Ошибка выполнения запроса:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ============================================
    // API: ВЫЗОВ ХРАНИМОЙ ПРОЦЕДУРЫ
    // ============================================

    app.post('/api/procedure', requireAuth, async (req, res) => {
        const { procedureName, params } = req.body;

        if (!procedureName || !procedureName.trim()) {
            return res.status(400).json({ success: false, error: 'Имя процедуры обязательно' });
        }

        try {
            const connection = await getConnectionForSession(req, connectionManager);

            const paramKeys = Object.keys(params || {});
            const bindParams = {};
            let paramPlaceholders = '';

            if (paramKeys.length > 0) {
                paramPlaceholders = paramKeys.map((key, index) => `:p${index}`).join(', ');
                paramKeys.forEach((key, index) => {
                    bindParams[`p${index}`] = params[key];
                });
            }

            const callSql = `BEGIN ${procedureName}(${paramPlaceholders}); END;`;
            const result = await connection.execute(callSql, bindParams);

            res.json({
                success: true,
                result: {
                    rowsAffected: result.rowsAffected,
                    outBinds: result.outBinds || {}
                }
            });

        } catch (err) {
            console.error('❌ Ошибка вызова процедуры:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });
};