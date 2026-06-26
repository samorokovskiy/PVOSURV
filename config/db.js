// config/db.js
const oracledb = require('oracledb');
const crypto = require('crypto');
require('dotenv').config();

// ============================================
// НАСТРОЙКИ ПУЛА СОЕДИНЕНИЙ
// ============================================

const poolConfig = {
    user: process.env.PS_DB_USER,
    password: process.env.PS_DB_PASS,
    connectionString: process.env.PS_DB_CONNECT_STRING,
    poolMin: parseInt(process.env.PS_POOL_MIN || '5', 10),
    poolMax: parseInt(process.env.PS_POOL_MAX || '20', 10),
    poolIncrement: 0,
    queueTimeout: 30000,
    poolPingInterval: 120
};

let pool;

/**
 * Инициализирует пул соединений с БД Oracle
 */
async function initPool() {
    try {
        if (pool) return pool;
        pool = await oracledb.createPool(poolConfig);
        console.log('✅ Пул соединений с БД создан');
        return pool;
    } catch (err) {
        console.error('❌ Ошибка создания пула:', err.message);
        throw err;
    }
}

/**
 * Возвращает экземпляр пула
 */
function getPool() {
    return pool;
}

// ============================================
// ФУНКЦИИ РАБОТЫ С СЕССИЯМИ ПАРУС
// ============================================

/**
 * Создает сессию Парус для пользователя
 */
async function authenticateParus(username, password, implementation, application) {
    let connection;
    const sConnectId = `WEB_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    try {
        connection = await pool.getConnection();

        await connection.execute(
            `BEGIN
                PARUS.PKG_SESSION.LOGON_WEB(
                    :sCONNECT,
                    :sUTILIZER,
                    :sPASSWORD,
                    :sIMPLEMENTATION,
                    :sAPPLICATION
                );
            END;`,
            {
                sCONNECT: sConnectId,
                sUTILIZER: username,
                sPASSWORD: password,
                sIMPLEMENTATION: implementation,
                sAPPLICATION: application
            }
        );

        // Сохраняем метаданные на объекте соединения
        connection._parusConnectId = sConnectId;
        connection._parusUser = username;
        connection._parusCreatedAt = Date.now();

        console.log(`✅ Сессия Парус создана: ${username} (${sConnectId})`);
        return connection;

    } catch (err) {
        if (connection) {
            try { await connection.close(); } catch (e) {}
        }
        console.error(`❌ Ошибка аутентификации ${username}:`, err.message);
        throw err;
    }
}

/**
 * Завершает сессию Парус и возвращает соединение в пул
 */
async function closeParusSession(connection, force = true) {
    if (!connection) {
        console.warn('⚠️ closeParusSession: соединение не передано');
        return false;
    }

    const user = connection._parusUser || 'неизвестный';
    const connectId = connection._parusConnectId;

    try {
        if (connectId) {
            try {
                await connection.execute(
                    `BEGIN PARUS.PKG_SESSION.LOGOFF_WEB(:sCONNECT); END;`,
                    { sCONNECT: connectId }
                );
                console.log(`✅ Сессия Парус завершена: ${user}`);
            } catch (logoffErr) {
                console.error(`⚠️ Ошибка LOGOFF_WEB для ${user}:`, logoffErr.message);
                if (!force) return false;
            }
        }

        try {
            await connection.close();
            console.log(`ℹ️ Соединение ${user} возвращено в пул`);
            return true;
        } catch (closeErr) {
            console.error(`⚠️ Ошибка при close() для ${user}:`, closeErr.message);
            return false;
        }

    } catch (err) {
        console.error(`❌ Критическая ошибка в closeParusSession:`, err.message);
        return false;
    }
}

/**
 * Проверяет живость сессии и пересоздает при необходимости
 */
async function ensureParusSession(connection, username, password, implementation, application) {
    if (!connection) {
        console.log(`🔄 Соединение отсутствует, создаем новое для ${username}`);
        return await authenticateParus(username, password, implementation, application);
    }

    try {
        await connection.execute(`SELECT 1 FROM DUAL`, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        
        const age = Date.now() - (connection._parusCreatedAt || 0);
        if (age > 25 * 60 * 1000) {
            console.log(`🔄 Сессия Парус старая (${Math.round(age/60000)} мин), пересоздаем`);
            await closeParusSession(connection);
            return await authenticateParus(username, password, implementation, application);
        }

        return connection;

    } catch (err) {
        console.log(`🔄 Сессия Парус неактивна, пересоздаем: ${err.message}`);
        try { await closeParusSession(connection); } catch (e) {}
        return await authenticateParus(username, password, implementation, application);
    }
}

// ============================================
// ПОЛУЧЕНИЕ СОЕДИНЕНИЯ ДЛЯ ТЕКУЩЕЙ СЕССИИ
// ============================================

/**
 * Возвращает актуальное соединение для текущей сессии пользователя
 * Используется в маршрутах
 */
async function getConnectionForSession(req, connectionManager) {
    const sessionId = req.sessionID;
    const user = req.session.user;
    const password = req.session.password;
    const implementation = req.session.implementation || process.env.PS_IMPLEMENTATION || 'DEFAULT';
    const application = req.session.application || process.env.PS_APPLICATION || 'PfmContact';

    let connection = connectionManager.get(sessionId);

    connection = await ensureParusSession(
        connection,
        user,
        password,
        implementation,
        application
    );

    connectionManager.set(sessionId, connection);
    return connection;
}

module.exports = {
    initPool,
    getPool,
    authenticateParus,
    closeParusSession,
    ensureParusSession,
    getConnectionForSession
};