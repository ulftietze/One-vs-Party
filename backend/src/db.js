import { Sequelize } from "sequelize";

export function makeSequelize() {
  const host = process.env.DB_HOST || "localhost";
  const port = Number(process.env.DB_PORT || 3306);
  const database = process.env.DB_NAME || "quizduell";
  const username = process.env.DB_USER || "quiz";
  const password = process.env.DB_PASS || "quizpw";

  return new Sequelize(database, username, password, {
    host,
    port,
    dialect: "mariadb",
    logging: false
  });
}
