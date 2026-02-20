import { DataTypes } from "sequelize";

export function defineModels(sequelize) {
  const Game = sequelize.define("Game", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    title: { type: DataTypes.STRING(200), allowNull: false },
    // Nur veröffentlichte Spiele erscheinen auf der Startseite
    isPublished: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    status: { type: DataTypes.ENUM("setup", "live", "finished"), allowNull: false, defaultValue: "setup" },
    currentQuestionIndex: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    phase: { type: DataTypes.ENUM("answering", "revealed"), allowNull: false, defaultValue: "answering" },
    // Bis zu welchem Index wurde bereits "Reveal" gedrückt? (Score wird nur bis hierhin gezählt)
    revealedQuestionIndex: { type: DataTypes.INTEGER, allowNull: false, defaultValue: -1 },

    // Gewinner-Text (im Admin editierbar)
    guestWinText: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    playerWinText: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    tieWinText: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },

    // Wird beim Beenden gesetzt: "guests" | "player" | "tie" | null
    winner: { type: DataTypes.ENUM("guests", "player", "tie"), allowNull: true, defaultValue: null },

    // Steuert, ob der Stand auf der Präsentationsseite/Gäste-Seite sichtbar ist
    showScore: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // Steuert, ob der Quiztitel auf der Präsentationsseite sichtbar ist
    showQuizTitle: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    // Auto-Reveal: automatisch auflösen, wenn alle abgegeben haben
    autoRevealEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    autoRevealDelaySeconds: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 2 },
    // UI language for this specific quiz/game (e.g. "en", "de")
    uiLanguage: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "en" },
    // Legacy-Spalte: bleibt im Schema, damit sequelize alter kein removeColumn ausführt (MariaDB/Sequelize edge case).
    isDryRun: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

    // Wird bei jedem (Neu-)Start aktualisiert, um Clients zum Re-Join zu zwingen
    lastStartedAt: { type: DataTypes.DATE, allowNull: true }
  });

  const Link = sequelize.define("Link", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    token: { type: DataTypes.STRING(64), allowNull: false },
    type: { type: DataTypes.ENUM("admin", "present", "guest_live", "guest_async", "player", "results"), allowNull: false }
  }, {
    indexes: [
      { name: "uniq_links_token", unique: true, fields: ["token"] }
    ]
  });

  const Question = sequelize.define("Question", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    text: { type: DataTypes.TEXT, allowNull: false },
    type: {
      type: DataTypes.ENUM("choice", "estimate", "order", "image_identity", "audio_identity", "video_identity", "risk"),
      allowNull: false,
      defaultValue: "choice"
    },
    allowMultiple: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    blockLabel: { type: DataTypes.STRING(120), allowNull: false, defaultValue: "General" },
    promptImage: { type: DataTypes.TEXT("long"), allowNull: false, defaultValue: "" },
    promptAudio: { type: DataTypes.TEXT("long"), allowNull: false, defaultValue: "" },
    promptVideo: { type: DataTypes.TEXT("long"), allowNull: false, defaultValue: "" },
    estimateTarget: { type: DataTypes.DOUBLE, allowNull: true, defaultValue: null },
    estimateTolerance: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    solutionType: { type: DataTypes.ENUM("none", "text", "image", "both"), allowNull: false, defaultValue: "none" },
    solutionText: { type: DataTypes.TEXT, allowNull: false, defaultValue: "" },
    solutionImage: { type: DataTypes.TEXT("long"), allowNull: false, defaultValue: "" },
    solutionAudio: { type: DataTypes.TEXT("long"), allowNull: false, defaultValue: "" },
    solutionVideo: { type: DataTypes.TEXT("long"), allowNull: false, defaultValue: "" },
    // Ab welcher Quote korrekter Gästeantworten die Gäste-Frage als "korrekt" gilt
    guestCorrectThresholdPercent: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50 }
  });

  const Option = sequelize.define("Option", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    text: { type: DataTypes.STRING(500), allowNull: false },
    image: { type: DataTypes.TEXT("long"), allowNull: false, defaultValue: "" },
    isCorrect: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    orderIndex: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }
  });

  const Participant = sequelize.define("Participant", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    kind: { type: DataTypes.ENUM("guest", "player"), allowNull: false },
    nickname: { type: DataTypes.STRING(80), allowNull: false },
    // Verknüpft einen Gast optional mit einem Client/Device für sicheres Re-Join
    clientKey: { type: DataTypes.STRING(80), allowNull: true }
  });

  const Answer = sequelize.define("Answer", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    // Für Multiple: kommaseparierte OptionIds
    optionIds: { type: DataTypes.STRING(200), allowNull: false }
  });

  const AdminSession = sequelize.define("AdminSession", {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tokenHash: { type: DataTypes.STRING(128), allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    revokedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    lastSeenAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    createdFromIp: { type: DataTypes.STRING(80), allowNull: true, defaultValue: null }
  }, {
    indexes: [
      { name: "uniq_admin_sessions_token_hash", unique: true, fields: ["tokenHash"] },
      { fields: ["expiresAt"] },
      { fields: ["revokedAt"] }
    ]
  });

  Game.hasMany(Link, { onDelete: "CASCADE" });
  Link.belongsTo(Game);

  Game.hasMany(Question, { onDelete: "CASCADE" });
  Question.belongsTo(Game);

  Question.hasMany(Option, { onDelete: "CASCADE" });
  Option.belongsTo(Question);

  Game.hasMany(Participant, { onDelete: "CASCADE" });
  Participant.belongsTo(Game);

  Participant.hasMany(Answer, { onDelete: "CASCADE" });
  Answer.belongsTo(Participant);

  Question.hasMany(Answer, { onDelete: "CASCADE" });
  Answer.belongsTo(Question);

  // Player-Beziehung: Game hat genau einen Player-Participant
  Game.belongsTo(Participant, { as: "Player", foreignKey: { name: "PlayerId", allowNull: false } });

  return { Game, Link, Question, Option, Participant, Answer, AdminSession };
}
