(function (global) {
  "use strict";

  const DIRECTIONS = Object.freeze({
    EN_JA: "en-ja",
    JA_EN: "ja-en"
  });

  const SPEAKERS = Object.freeze({
    USER: "user",
    PARTNER: "partner"
  });

  const ORIGINS = Object.freeze({
    MANUAL: "manual",
    AI: "ai"
  });

  const UNIT_TYPES = Object.freeze({
    SENTENCE: "sentence",
    PARAGRAPH: "paragraph",
    OPTION: "option"
  });

  const INPUT_KINDS = Object.freeze({
    ENGLISH: "english",
    JAPANESE: "japanese",
    TRANSLITERATION: "transliteration",
    MIXED: "mixed",
    UNKNOWN: "unknown"
  });

  function nowISO() {
    return new Date().toISOString();
  }

  function createId(prefix) {
    const safePrefix = String(prefix || "item")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "") || "item";

    if (
      global.crypto &&
      typeof global.crypto.randomUUID === "function"
    ) {
      return safePrefix + "_" + global.crypto.randomUUID();
    }

    return (
      safePrefix +
      "_" +
      Date.now() +
      "_" +
      Math.random().toString(36).slice(2, 10)
    );
  }

  function cleanText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanMultilineText(value) {
    return String(value ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  function isDirection(value) {
    return value === DIRECTIONS.EN_JA || value === DIRECTIONS.JA_EN;
  }

  function isSpeaker(value) {
    return value === SPEAKERS.USER || value === SPEAKERS.PARTNER;
  }

  function isOrigin(value) {
    return value === ORIGINS.MANUAL || value === ORIGINS.AI;
  }

  function getDirectionConfig(direction) {
    assert(isDirection(direction), "Unsupported conversation direction.");

    if (direction === DIRECTIONS.EN_JA) {
      return Object.freeze({
        direction,
        sourceLanguage: "English",
        sourceCode: "en",
        targetLanguage: "Japanese",
        targetCode: "ja",
        targetIsJapanese: true
      });
    }

    return Object.freeze({
      direction,
      sourceLanguage: "Japanese",
      sourceCode: "ja",
      targetLanguage: "English",
      targetCode: "en",
      targetIsJapanese: false
    });
  }

  function nextSpeaker(lastSpeaker) {
    if (!lastSpeaker) {
      return SPEAKERS.PARTNER;
    }

    assert(isSpeaker(lastSpeaker), "Invalid last speaker.");

    return lastSpeaker === SPEAKERS.USER
      ? SPEAKERS.PARTNER
      : SPEAKERS.USER;
  }

  function createSegment(input) {
    const segment = input || {};

    const normalized = {
      english: cleanText(segment.english),
      japanese: cleanText(segment.japanese),
      transliteration: cleanText(segment.transliteration)
    };

    assert(
      normalized.english || normalized.japanese,
      "A segment must contain English or Japanese text."
    );

    return normalized;
  }

  function normalizeSegments(segments) {
    return asArray(segments)
      .map(createSegment)
      .filter(function (segment) {
        return segment.english || segment.japanese;
      });
  }

  function normalizeLinguisticData(input) {
    const data = input || {};

    const normalized = {
      english: cleanText(data.english),
      japanese: cleanText(data.japanese),
      segments: normalizeSegments(data.segments)
    };

    assert(normalized.english, "English text is required.");
    assert(normalized.japanese, "Japanese text is required.");
    assert(
      normalized.segments.length > 0,
      "At least one breakdown segment is required."
    );

    return normalized;
  }

  function createSentence(input) {
    const data = input || {};
    const linguistic = normalizeLinguisticData(data);
    const createdAt = cleanText(data.createdAt) || nowISO();

    const sentence = {
      id: cleanText(data.id) || createId("sentence"),
      type: UNIT_TYPES.SENTENCE,
      order: Number.isFinite(Number(data.order))
        ? Number(data.order)
        : 0,
      speaker: data.speaker || SPEAKERS.USER,
      origin: data.origin || ORIGINS.MANUAL,
      originalInput: cleanMultilineText(data.originalInput),
      inputKind: Object.values(INPUT_KINDS).includes(data.inputKind)
        ? data.inputKind
        : INPUT_KINDS.UNKNOWN,
      english: linguistic.english,
      japanese: linguistic.japanese,
      segments: linguistic.segments,
      paragraphId: cleanText(data.paragraphId) || null,
      createdAt,
      updatedAt: cleanText(data.updatedAt) || createdAt
    };

    assert(isSpeaker(sentence.speaker), "Invalid sentence speaker.");
    assert(isOrigin(sentence.origin), "Invalid sentence origin.");

    return sentence;
  }

  function createOption(input) {
    const data = input || {};
    const linguistic = normalizeLinguisticData(data);

    return {
      id: cleanText(data.id) || createId("option"),
      type: UNIT_TYPES.OPTION,
      sourceSentenceId: cleanText(data.sourceSentenceId) || null,
      english: linguistic.english,
      japanese: linguistic.japanese,
      segments: linguistic.segments,
      createdAt: cleanText(data.createdAt) || nowISO()
    };
  }

  function createParagraph(input) {
    const data = input || {};
    const linguistic = normalizeLinguisticData(data);

    const sentenceIds = Array.from(
      new Set(
        asArray(data.sentenceIds)
          .map(cleanText)
          .filter(Boolean)
      )
    );

    assert(
      sentenceIds.length >= 2,
      "A paragraph must contain at least two sentence IDs."
    );

    return {
      id: cleanText(data.id) || createId("paragraph"),
      type: UNIT_TYPES.PARAGRAPH,
      sentenceIds,
      anchorOrder: Number.isFinite(Number(data.anchorOrder))
        ? Number(data.anchorOrder)
        : 0,
      english: linguistic.english,
      japanese: linguistic.japanese,
      segments: linguistic.segments,
      createdAt: cleanText(data.createdAt) || nowISO(),
      updatedAt: cleanText(data.updatedAt) || nowISO()
    };
  }

  function createRoom(input) {
    const data = input || {};
    const direction = data.direction || DIRECTIONS.EN_JA;

    assert(isDirection(direction), "Invalid room direction.");

    const createdAt = cleanText(data.createdAt) || nowISO();

    return {
      id: cleanText(data.id) || createId("room"),
      name: cleanText(data.name) || "Conversation",
      direction,
      createdAt,
      updatedAt: cleanText(data.updatedAt) || createdAt
    };
  }

  function sortByOrder(items) {
    return asArray(items)
      .slice()
      .sort(function (a, b) {
        const orderA = Number(a?.order ?? a?.anchorOrder ?? 0);
        const orderB = Number(b?.order ?? b?.anchorOrder ?? 0);

        if (orderA !== orderB) {
          return orderA - orderB;
        }

        return String(a?.id || "").localeCompare(String(b?.id || ""));
      });
  }

  function toHistoryItem(sentence) {
    assert(sentence && sentence.type === UNIT_TYPES.SENTENCE, "Sentence required.");

    return {
      speaker: sentence.speaker,
      english: cleanText(sentence.english),
      japanese: cleanText(sentence.japanese)
    };
  }

  function sentenceTargetText(sentence, direction) {
    const config = getDirectionConfig(direction);
    return config.targetIsJapanese
      ? cleanText(sentence?.japanese)
      : cleanText(sentence?.english);
  }

  function sentenceSourceText(sentence, direction) {
    const config = getDirectionConfig(direction);
    return config.targetIsJapanese
      ? cleanText(sentence?.english)
      : cleanText(sentence?.japanese);
  }

  global.ConversateModel = Object.freeze({
    DIRECTIONS,
    SPEAKERS,
    ORIGINS,
    UNIT_TYPES,
    INPUT_KINDS,
    createId,
    cleanText,
    cleanMultilineText,
    isDirection,
    isSpeaker,
    isOrigin,
    getDirectionConfig,
    nextSpeaker,
    createSegment,
    normalizeSegments,
    normalizeLinguisticData,
    createSentence,
    createOption,
    createParagraph,
    createRoom,
    sortByOrder,
    toHistoryItem,
    sentenceTargetText,
    sentenceSourceText
  });
})(window);
