import { nanoid } from "nanoid";

function asQuestionType(question) {
  const t = String(question?.type || "choice").trim().toLowerCase();
  if (["choice", "estimate", "order", "image_identity", "audio_identity", "video_identity", "risk"].includes(t)) return t;
  return "choice";
}

function parseStoredAnswer(question, optionIdsRaw) {
  const type = asQuestionType(question);
  const raw = String(optionIdsRaw || "");
  if (type === "estimate") {
    const first = raw.split(",")[0]?.trim();
    return first ? [first] : [];
  }
  return raw.split(",").map(String).map(s => s.trim()).filter(Boolean);
}

function normalizeAnswerForCompare(question, answer) {
  const type = asQuestionType(question);
  if (type === "estimate") return answer.slice(0, 1);
  if (type === "order") return answer.map(String).filter(Boolean);
  return answer.map(String).filter(Boolean).sort();
}

function optionOrder(question) {
  const opts = Array.isArray(question?.Options) ? question.Options : [];
  return [...opts].sort((a, b) => Number(a.orderIndex || 0) - Number(b.orderIndex || 0) || Number(a.id || 0) - Number(b.id || 0));
}

function isEstimateCorrect(question, answer) {
  const target = Number(question?.estimateTarget);
  const tolerance = Math.max(0, Number(question?.estimateTolerance || 0));
  const value = Number(answer?.[0]);
  if (!Number.isFinite(target) || !Number.isFinite(value)) return false;
  return Math.abs(value - target) <= tolerance;
}

function isOrderCorrect(question, answer) {
  const selected = normalizeAnswerForCompare(question, answer);
  const expected = optionOrder(question).map(o => String(o.id));
  if (!selected.length || selected.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (selected[i] !== expected[i]) return false;
  }
  return true;
}

function isChoiceLikeCorrect(question, answer) {
  const selected = normalizeAnswerForCompare(question, answer);
  const correct = (question?.Options || []).filter(o => !!o.isCorrect).map(o => String(o.id)).sort();
  if (!selected.length || selected.length !== correct.length) return false;
  for (let i = 0; i < correct.length; i++) {
    if (selected[i] !== correct[i]) return false;
  }
  return true;
}

function hasSubmittedAnswer(question, answer) {
  const type = asQuestionType(question);
  if (type === "estimate") return Number.isFinite(Number(answer?.[0]));
  return Array.isArray(answer) && answer.length > 0;
}

export function evaluateAnswer(question, answerRaw) {
  const answer = normalizeAnswerForCompare(question, (answerRaw || []).map(String));
  const type = asQuestionType(question);
  if (type === "estimate") return isEstimateCorrect(question, answer);
  if (type === "order") return isOrderCorrect(question, answer);
  return isChoiceLikeCorrect(question, answer);
}

function pointsForQuestion(question, isCorrect) {
  if (asQuestionType(question) !== "risk") return isCorrect ? 1 : 0;
  return isCorrect ? 2 : -2;
}

function keyForAnswer(question, answerRaw) {
  const answer = normalizeAnswerForCompare(question, answerRaw);
  if (!hasSubmittedAnswer(question, answer)) return "";
  return answer.join(",");
}

function guestTeamWinnerForQuestion(question, guestAnswers) {
  const type = asQuestionType(question);
  if (type === "estimate") {
    const numericValues = guestAnswers
      .map(a => Number(parseStoredAnswer(question, a.optionIds)[0]))
      .filter(v => Number.isFinite(v))
      .sort((a, b) => a - b);
    if (!numericValues.length) return { winnerKey: null, isCorrect: false, hasAnswer: false };

    const mid = Math.floor(numericValues.length / 2);
    const teamGuess = numericValues.length % 2
      ? numericValues[mid]
      : (numericValues[mid - 1] + numericValues[mid]) / 2;
    const key = String(teamGuess);
    return {
      winnerKey: key,
      isCorrect: evaluateAnswer(question, [key]),
      hasAnswer: true
    };
  }

  const counts = new Map();
  for (const a of guestAnswers) {
    const key = keyForAnswer(question, parseStoredAnswer(question, a.optionIds));
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size === 0) return { winnerKey: null, isCorrect: false, hasAnswer: false };

  const bestCount = Math.max(...counts.values());
  const candidates = [...counts.entries()].filter(([, c]) => c === bestCount).map(([k]) => k);
  if (candidates.length === 1) {
    const key = candidates[0];
    return { winnerKey: key, isCorrect: evaluateAnswer(question, key.split(",").filter(Boolean)), hasAnswer: true };
  }

  const correctCandidate = candidates.find(k => evaluateAnswer(question, k.split(",").filter(Boolean)));
  if (correctCandidate) return { winnerKey: correctCandidate, isCorrect: true, hasAnswer: true };

  const key = candidates.sort()[0];
  return { winnerKey: key, isCorrect: false, hasAnswer: true };
}

export async function createGame(models, { title, playerName, uiLanguage = "en" }) {
  const player = await models.Participant.create({ kind: "player", nickname: playerName || "Player" });
  const game = await models.Game.create({ title, PlayerId: player.id, uiLanguage });

  await player.update({ GameId: game.id });

  const mk = async (type) => models.Link.create({ GameId: game.id, type, token: nanoid(16) });

  const links = {
    admin: await mk("admin"),
    present: await mk("present"),
    guest_live: await mk("guest_live"),
    guest_async: await mk("guest_async"),
    player: await mk("player"),
    results: await mk("results")
  };

  return { game, links, player };
}

export async function getGameByToken(models, token) {
  const link = await models.Link.findOne({ where: { token } });
  if (!link) return null;
  const game = await models.Game.findByPk(link.GameId);
  if (!game) return null;
  return { link, game };
}

export async function loadGameFull(models, gameId) {
  return models.Game.findByPk(gameId, {
    include: [
      {
        model: models.Question,
        include: [models.Option]
      },
      { model: models.Participant, as: "Player" }
    ],
    order: [
      [models.Question, "sortOrder", "ASC"],
      [models.Question, "id", "ASC"],
      [models.Question, models.Option, "orderIndex", "ASC"],
      [models.Question, models.Option, "id", "ASC"]
    ]
  });
}

export async function computeScore(models, gameId, { uptoIndex = null } = {}) {
  const full = await loadGameFull(models, gameId);
  if (!full) return { player: 0, guests: 0, playerName: "Player", rankings: [] };

  const player = await models.Participant.findByPk(full.PlayerId);
  const guests = await models.Participant.findAll({ where: { GameId: gameId, kind: "guest" } });

  const questionsAll = full.Questions || [];
  const questions = (uptoIndex === null || uptoIndex === undefined)
    ? questionsAll
    : questionsAll.slice(0, Math.max(0, Number(uptoIndex) + 1));

  const questionIds = questionsAll.map(q => q.id);
  const answers = questionIds.length
    ? await models.Answer.findAll({ where: { QuestionId: questionIds } })
    : [];

  const answersByP = new Map();
  for (const a of answers) {
    if (!answersByP.has(a.ParticipantId)) answersByP.set(a.ParticipantId, []);
    answersByP.get(a.ParticipantId).push(a);
  }

  const scoreFor = (participant, questionSet) => {
    if (!participant) return 0;
    const arr = answersByP.get(participant.id) || [];
    const byQ = new Map(arr.map(a => [a.QuestionId, a]));
    let score = 0;
    for (const q of questionSet) {
      const a = byQ.get(q.id);
      if (!a) continue;
      const answer = parseStoredAnswer(q, a.optionIds);
      if (!hasSubmittedAnswer(q, answer)) continue;
      const correct = evaluateAnswer(q, answer);
      score += pointsForQuestion(q, correct);
    }
    return score;
  };

  const playerScore = scoreFor(player, questions);

  let guestTeamScore = 0;
  for (const q of questions) {
    const guestAnswers = [];
    for (const g of guests) {
      const arr = answersByP.get(g.id) || [];
      const a = arr.find(x => x.QuestionId === q.id);
      if (a) guestAnswers.push(a);
    }
    const teamResult = guestTeamWinnerForQuestion(q, guestAnswers);
    if (!teamResult.hasAnswer) continue;
    guestTeamScore += pointsForQuestion(q, teamResult.isCorrect);
  }

  const rankings = guests.map(g => ({
    id: g.id,
    nickname: g.nickname,
    score: scoreFor(g, questions)
  })).sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname));

  return {
    player: playerScore,
    guests: guestTeamScore,
    playerName: player?.nickname || "Player",
    rankings
  };
}

export async function computeGuestVoteCounts(models, { gameId, question }) {
  const type = asQuestionType(question);
  if (type === "estimate" || type === "order") return [];

  const guests = await models.Participant.findAll({ where: { GameId: gameId, kind: "guest" } });
  if (!guests.length) {
    return question.Options.map(o => ({
      id: o.id,
      text: o.text,
      image: o.image || "",
      count: 0,
      isCorrect: !!o.isCorrect
    }));
  }

  const answers = await models.Answer.findAll({
    where: { QuestionId: question.id, ParticipantId: guests.map(g => g.id) }
  });

  const counts = new Map(question.Options.map(o => [String(o.id), 0]));
  for (const a of answers) {
    const ids = parseStoredAnswer(question, a.optionIds);
    for (const id of ids) {
      if (counts.has(String(id))) counts.set(String(id), (counts.get(String(id)) || 0) + 1);
    }
  }

  return question.Options.map(o => ({
    id: o.id,
    text: o.text,
    image: o.image || "",
    count: counts.get(String(o.id)) || 0,
    isCorrect: !!o.isCorrect
  }));
}

export function publicLinks(baseUrl, links) {
  const mk = (t) => `${baseUrl}/#/t/${t}`;
  return {
    admin: mk(links.admin.token),
    present: mk(links.present.token),
    guest_live: mk(links.guest_live.token),
    guest_async: mk(links.guest_async.token),
    player: mk(links.player.token),
    results: links.results?.token ? mk(links.results.token) : null
  };
}
