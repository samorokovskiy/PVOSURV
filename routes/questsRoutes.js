// routes/questsRoutes.js
const oracledb = require('oracledb');
const path = require('path');
const { getConnectionForSession } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { connectionManager } = require('./authRoutes');

// Префикс владельца схемы PARUS
const SCHEMA = 'PARUS';

module.exports = function(app) {

    // ============================================
    // СТРАНИЦА АНКЕТ
    // ============================================

    app.get('/quests', requireAuth, (req, res) => {
        res.sendFile(path.join(__dirname, '../views', 'quests.html'));
    });

    // ============================================
    // API: ПОЛУЧЕНИЕ СПИСКА АНКЕТ
    // ============================================

    app.get('/api/quests-list', requireAuth, async (req, res) => {
        try {
            const connection = await getConnectionForSession(req, connectionManager);

            const result = await connection.execute(
                `SELECT 
                    NRN,
                    SNUMB,
                    STHEME_NAME,
                    STHEME_SPLASH,
                    NQCOUNT,
                    DREG_DATE,
                    DBEGIN_DATE,
                    DEND_DATE,
                    SAGNLIST
                 FROM ${SCHEMA}.V_UD_QUESTS
                 ORDER BY DREG_DATE DESC, SNUMB`,
                [],
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            res.json({ success: true, data: result.rows });

        } catch (err) {
            console.error('❌ Ошибка получения списка анкет:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ============================================
    // API: ПОЛУЧЕНИЕ ВОПРОСОВ ДЛЯ АНКЕТЫ
    // ============================================

    app.get('/api/quests-questions/:nrn', requireAuth, async (req, res) => {
        try {
            const { nrn } = req.params;
            
            if (!nrn) {
                return res.status(400).json({ success: false, error: 'Не указан номер анкеты' });
            }

            const connection = await getConnectionForSession(req, connectionManager);

            const result = await connection.execute(
                `SELECT 
                    NRN,
                    NPRN,
                    NORD,
                    SQUESTION,
                    NCHOISE_TYPE
                 FROM ${SCHEMA}.V_UD_QUESTSQ
                 WHERE NPRN = :NPRN
                 ORDER BY NORD, NRN`,
                { NPRN: parseInt(nrn) },
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            res.json({ success: true, data: result.rows });

        } catch (err) {
            console.error('❌ Ошибка получения вопросов для анкеты:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });
};