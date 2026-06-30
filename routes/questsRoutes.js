// routes/questsRoutes.js
const oracledb = require('oracledb');
const path = require('path');
const { getConnectionForSession } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { connectionManager } = require('./authRoutes');

// Префикс владельца схемы PARUS
const SCHEMA = 'PARUS';

// Количество вопросов на странице (из .env)
const QUESTIONS_PER_PAGE = parseInt(process.env.QUESTIONS_PER_PAGE || '10', 10);

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
    // API: ПОЛУЧЕНИЕ ВОПРОСОВ ДЛЯ АНКЕТЫ (с пагинацией)
    // ============================================

    app.get('/api/quests-questions/:nrn', requireAuth, async (req, res) => {
        try {
            const { nrn } = req.params;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || QUESTIONS_PER_PAGE;
            const offset = (page - 1) * limit;

            if (!nrn) {
                return res.status(400).json({ success: false, error: 'Не указан номер анкеты' });
            }

            const connection = await getConnectionForSession(req, connectionManager);

            // Получаем общее количество вопросов для анкеты
            const countResult = await connection.execute(
                `SELECT COUNT(*) AS TOTAL
                 FROM ${SCHEMA}.V_UD_QUESTSQ
                 WHERE NPRN = :1`,
                [parseInt(nrn)],
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            const totalQuestions = countResult.rows[0]?.TOTAL || 0;
            const totalPages = Math.ceil(totalQuestions / limit);
            const maxRownum = offset + limit;

            // Получаем вопросы с пагинацией через ROWNUM
            const result = await connection.execute(
                `SELECT 
                    NRN,
                    NPRN,
                    NORD,
                    SQUESTION,
                    NCHOISE_TYPE
                 FROM (
                     SELECT 
                         NRN,
                         NPRN,
                         NORD,
                         SQUESTION,
                         NCHOISE_TYPE,
                         ROWNUM AS RN
                     FROM (
                         SELECT 
                             NRN,
                             NPRN,
                             NORD,
                             SQUESTION,
                             NCHOISE_TYPE
                         FROM ${SCHEMA}.V_UD_QUESTSQ
                         WHERE NPRN = :1
                         ORDER BY NORD, NRN
                     )
                     WHERE ROWNUM <= :2
                 )
                 WHERE RN > :3`,
                [parseInt(nrn), maxRownum, offset],
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            res.json({ 
                success: true, 
                data: result.rows,
                pagination: {
                    page: page,
                    limit: limit,
                    total: totalQuestions,
                    totalPages: totalPages,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            });

        } catch (err) {
            console.error('❌ Ошибка получения вопросов для анкеты:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ============================================
    // API: ПОЛУЧЕНИЕ ВАРИАНТОВ ОТВЕТОВ ДЛЯ ВОПРОСА
    // ============================================

    app.get('/api/quests-choices/:nrn', requireAuth, async (req, res) => {
        try {
            const { nrn } = req.params;

            if (!nrn) {
                return res.status(400).json({ success: false, error: 'Не указан номер вопроса' });
            }

            const connection = await getConnectionForSession(req, connectionManager);

            const result = await connection.execute(
                `SELECT 
                    NRN,
                    NPRN,
                    SCHOISE,
                    SCHOISE_TEXT,
                    NVALID,
                    NORD
                 FROM ${SCHEMA}.V_UD_QUESTSQC
                 WHERE NPRN = :1
                 ORDER BY NORD, NRN`,
                [parseInt(nrn)],
                { outFormat: oracledb.OUT_FORMAT_OBJECT }
            );

            res.json({ success: true, data: result.rows });

        } catch (err) {
            console.error('❌ Ошибка получения вариантов ответов:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ============================================
    // API: СОХРАНЕНИЕ ОТВЕТА
    // ============================================

    app.post('/api/save-answer', requireAuth, async (req, res) => {
        const { questionNrn, choiceType, choices } = req.body;

        if (!questionNrn) {
            return res.status(400).json({ success: false, error: 'Не указан номер вопроса' });
        }

        try {
            const connection = await getConnectionForSession(req, connectionManager);

            if (choiceType === 0) {
                // Свободный ввод: сохраняем только текст
                const answerText = choices?.[0]?.text || '';
                await connection.execute(
                    `BEGIN
                        ${SCHEMA}.P_UD_QUESTSC_ANS(
                            :1,
                            :2,
                            :3,
                            :4
                        );
                    END;`,
                    [
                        questionNrn,
                        null,
                        null,
                        answerText
                    ]
                );
                console.log(`✅ Текстовый ответ сохранен для вопроса ${questionNrn}`);
                
            } else if (choiceType === 1 || choiceType === 2) {
                // Одиночный или множественный выбор: сохраняем ВСЕ варианты
                if (!choices || choices.length === 0) {
                    return res.status(400).json({ success: false, error: 'Не переданы варианты ответов' });
                }

                for (const choice of choices) {
                    await connection.execute(
                        `BEGIN
                            ${SCHEMA}.P_UD_QUESTSC_ANS(
                                :1,
                                :2,
                                :3,
                                :4
                            );
                        END;`,
                        [
                            questionNrn,
                            choice.nrn,
                            choice.isValid ? 1 : 0,
                            null
                        ]
                    );
                }
                const typeLabel = choiceType === 1 ? 'Одиночный выбор' : 'Множественный выбор';
                console.log(`✅ ${typeLabel} сохранен для вопроса ${questionNrn} (${choices.length} вариантов)`);
                
            } else {
                return res.status(400).json({ success: false, error: 'Неизвестный тип вопроса' });
            }

            res.json({ success: true });

        } catch (err) {
            console.error('❌ Ошибка сохранения ответа:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ============================================
    // API: ЗАВЕРШЕНИЕ ОПРОСА
    // ============================================

    app.post('/api/close-questionnaire', requireAuth, async (req, res) => {
        const { questNrn } = req.body;

        if (!questNrn) {
            return res.status(400).json({ success: false, error: 'Не указан номер анкеты' });
        }

        try {
            const connection = await getConnectionForSession(req, connectionManager);

            // Вызываем процедуру завершения опроса
            await connection.execute(
                `BEGIN
                    ${SCHEMA}.P_UD_QUESTS_CLOSE(:1);
                END;`,
                [parseInt(questNrn)]
            );

            console.log(`✅ Опрос для анкеты ${questNrn} завершен`);
            res.json({ success: true });

        } catch (err) {
            console.error('❌ Ошибка завершения опроса:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });
};