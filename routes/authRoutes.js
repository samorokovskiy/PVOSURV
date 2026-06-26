// routes/authRoutes.js
const path = require('path');
const { authenticateParus, closeParusSession } = require('../config/db');

/**
 * Менеджер соединений (хранит активные соединения по sessionId)
 * @type {Map<string, object>}
 */
const connectionManager = new Map();

module.exports = function(app) {

    // ============================================
    // ГЛАВНАЯ СТРАНИЦА - ФОРМА ВХОДА
    // ============================================

    app.get('/', (req, res) => {
        if (req.session.user) {
            return res.redirect('/quests');
        }
        res.sendFile(path.join(__dirname, '../views', 'login.html'));
    });
    // ============================================
    // СТРАНИЦА ВХОДА (GET) - для прямой ссылки /login
    // ============================================

    app.get('/login', (req, res) => {
        if (req.session.user) {
            return res.redirect('/quests');
        }
        res.sendFile(path.join(__dirname, '../views', 'login.html'));
    });
    // ============================================
    // ОБРАБОТКА ВХОДА (POST)
    // ============================================

    app.post('/login', async (req, res) => {
        const { username, password, implementation, application } = req.body;

        if (!username?.trim() || !password?.trim()) {
            return res.status(400).send(`
                <h2>❌ Логин и пароль обязательны</h2>
                <a href="/">Вернуться</a>
            `);
        }

        try {
            // Аутентификация в Парус
            const connection = await authenticateParus(
                username.trim(),
                password.trim(),
                implementation || process.env.PS_IMPLEMENTATION || 'DEFAULT',
                application || process.env.PS_APPLICATION || 'PfmContact'
            );

            // Сохраняем данные в сессии Express
            req.session.user = username.trim();
            req.session.password = password.trim();
            req.session.implementation = implementation || process.env.PS_IMPLEMENTATION || 'DEFAULT';
            req.session.application = application || process.env.PS_APPLICATION || 'PfmContact';
            req.session.lastActivity = Date.now();

            // Сохраняем соединение в менеджере
            if (connectionManager.has(req.sessionID)) {
                try {
                    await closeParusSession(connectionManager.get(req.sessionID));
                } catch (e) {}
            }
            connectionManager.set(req.sessionID, connection);

            console.log(`✅ Пользователь ${username} вошел. Сессия: ${req.sessionID}`);
            res.redirect('/quests');

        } catch (err) {
            let errorMessage = 'Ошибка аутентификации. Проверьте логин и пароль.';
            if (err.errorNum === 1017) errorMessage = '❌ Неверный логин или пароль.';
            if (err.errorNum === 6502) errorMessage = '❌ Ошибка параметров аутентификации.';

            console.error(`❌ Ошибка входа ${username}:`, err.message);
            res.status(401).send(`
                <h2>${errorMessage}</h2>
                <a href="/">Вернуться на страницу входа</a>
            `);
        }
    });

    // ============================================
    // ВЫХОД ИЗ СИСТЕМЫ (POST)
    // ============================================

    app.post('/logout', async (req, res) => {
        const sessionId = req.sessionID;
        const connection = connectionManager.get(sessionId);

        if (connection) {
            await closeParusSession(connection);
            connectionManager.delete(sessionId);
            console.log(`✅ Пользователь ${req.session?.user || 'неизвестный'} вышел`);
        }

        req.session.destroy((err) => {
            if (err) console.error('Ошибка уничтожения сессии:', err);
            res.clearCookie('connect.sid');
            res.json({ success: true, redirect: '/' });
        });
    });

    // Экспортируем connectionManager для использования в других модулях
    module.exports.connectionManager = connectionManager;
};