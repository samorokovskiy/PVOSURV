// server.js
require('dotenv').config();

const oracledb = require('oracledb');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');

process.env.UV_THREADPOOL_SIZE = parseInt(process.env.PS_POOL_MAX || '20', 10) + 4;

try {
    oracledb.initOracleClient();
    console.log('✅ Oracle Thick Mode инициализирован');
} catch (err) {
    if (!err.message.includes('NJS-010')) {
        console.error('❌ Ошибка инициализации Oracle Client:', err.message);
        process.exit(1);
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET || 'fallback_cookie_secret'));
app.use(express.static('public'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'super_secret_change_me_in_production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// ============================================
// РЕГИСТРАЦИЯ МАРШРУТОВ
// ============================================
require('./routes/authRoutes')(app);
require('./routes/questsRoutes')(app);   // ← НОВЫЙ МАРШРУТ
require('./routes/apiRoutes')(app);
// require('./routes/ankRoutes')(app);   // ← МОЖНО УДАЛИТЬ ИЛИ ЗАКОММЕНТИРОВАТЬ

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================
const { initPool } = require('./config/db');

let server;

async function startServer() {
    try {
        await initPool();
        server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Сервер запущен на http://localhost:${PORT}`);
        });
        server.on('error', (error) => {
            console.error('❌ Критическая ошибка HTTP-сервера:', error);
            gracefulShutdown('SERVER_ERROR', 1);
        });
    } catch (err) {
        console.error('❌ Не удалось запустить сервер:', err.message);
        process.exit(1);
    }
}

async function gracefulShutdown(signal, exitCode = 0) {
    console.log(`\n⏳ Получен сигнал ${signal}. Завершение работы...`);

    if (server && server.listening) {
        server.close(() => console.log('🛑 HTTP-сервер остановлен'));
    }

    const { connectionManager } = require('./routes/authRoutes');
    const { closeParusSession } = require('./config/db');

    if (connectionManager && connectionManager.size > 0) {
        console.log(`⏳ Закрытие ${connectionManager.size} сессий...`);
        for (const [sessionId, connection] of connectionManager.entries()) {
            try { await closeParusSession(connection); } catch (e) {}
        }
        connectionManager.clear();
    }

    const pool = require('./config/db').getPool();
    if (pool) {
        try {
            await pool.close();
            console.log('✅ Пул соединений закрыт');
        } catch (err) {
            console.error('❌ Ошибка закрытия пула:', err.message);
        }
    }

    console.log('👋 Работа завершена.');
    process.exit(exitCode);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
    gracefulShutdown('CRASH', 1);
});

startServer();