import { Sequelize } from "sequelize";

export function makeSequelize() {
  const host = process.env.DB_HOST || "localhost";
  const port = Number(process.env.DB_PORT || 3306);
  const database = process.env.DB_NAME || "quizduell";
  const username = process.env.DB_USER || "quiz";
  const password = process.env.DB_PASS || "quizpw";
  const poolMax = Math.max(5, Number(process.env.DB_POOL_MAX || 30));
  const poolMin = Math.max(0, Math.min(poolMax, Number(process.env.DB_POOL_MIN || 5)));
  const poolAcquire = Math.max(1_000, Number(process.env.DB_POOL_ACQUIRE_MS || 30_000));
  const poolIdle = Math.max(1_000, Number(process.env.DB_POOL_IDLE_MS || 10_000));

  return new Sequelize(database, username, password, {
    host,
    port,
    dialect: "mariadb",
    logging: false,
    pool: {
      max: poolMax,
      min: poolMin,
      acquire: poolAcquire,
      idle: poolIdle
    }
  });
}
