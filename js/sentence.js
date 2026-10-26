(function (global) {
  "use strict";

  /*
  ==================================================
  CONVERSATE PRO JAPANESE
  SENTENCE CONTROLLER
  ==================================================

  PURPOSE

  This file is the only layer that turns:

    - manual learner/partner input
    - an AI-generated turn
    - an accepted Option

  into the standard Sentence object defined by
  model.js.

  It does NOT:

    - render HTML
    - save to Firebase
    - search dictionary.js
    - generate Options
    - build paragraphs
    - play audio

  Required load order:

    model.js
    ai.js
    sentence.js
  ==================================================
  */


  function getModel() {
    const Model = global.ConversateModel;

    if (!Model) {
      throw new Error(
        "model.js must be loaded before sentence.js."
      );
    }

    return Model;
  }


  function getAI() {
    const AI = global.ConversateAI;

    if (!AI) {
      throw new Error(
        "ai.js must be loaded before sentence.js."
      );
    }

    return AI;
  }


  function normalizeOrder(value, fallback) {
    const number = Number(value);

    if (Number.isFinite(number)) {
      return number;
    }

    const fallbackNumber = Number(fallback);

    return Number.isFinite(fallbackNumber)
      ? fallbackNumber
      : 0;
  }


  function validateCommonInput(input) {
    const Model = getModel();
    const data = input || {};

    if (!Model.isDirection(data.direction)) {
      throw new Error(
        "A valid direction is required. Use 'en-ja' or 'ja-en'."
      );
    }

    if (!Model.isSpeaker(data.speaker)) {
      throw new Error(
        "A valid speaker is required. Use 'user' or 'partner'."
      );
    }

    return data;
  }


  /*
  ==================================================
  PROCESS MANUAL INPUT
  ==================================================

  Example:

    await ConversateSentence.processManual({
      direction: "en-ja",
      speaker: "user",
      text: "dahabto illal madrasa",
      order: 1
    });

  Returns:

    {
      valid: true,
      message: "",
      sentence: { ...standard Sentence }
    }

  If the learner clearly enters more than one
  independent sentence, the AI layer returns:

    {
      valid: false,
      message: "Please enter one sentence at a time.",
      sentence: null
    }
  ==================================================
  */

  async function processManual(input, options) {
    const Model = getModel();
    const AI = getAI();
    const data = validateCommonInput(input);

    const originalInput =
      Model.cleanMultilineText(data.text);

    if (!originalInput) {
      throw new Error("Enter one sentence.");
    }

    const processed = await AI.processSentence(
      {
        direction: data.direction,
        text: originalInput
      },
      options
    );

    if (processed.valid !== true) {
      return {
        valid: false,
        message:
          Model.cleanText(processed.message) ||
          "Please enter one sentence at a time.",
        sentence: null
      };
    }

    const linguistic =
      Model.normalizeLinguisticData(
        processed.linguisticData
      );

    const sentence = Model.createSentence({
      id: data.id,
      order: normalizeOrder(data.order, 0),
      speaker: data.speaker,
      origin: Model.ORIGINS.MANUAL,
      originalInput,
      inputKind: processed.inputKind,
      english: linguistic.english,
      japanese: linguistic.japanese,
      segments: linguistic.segments,
      paragraphId: data.paragraphId || null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    });

    return {
      valid: true,
      message: "",
      sentence
    };
  }


  /*
  ==================================================
  UPDATE AN EXISTING MANUAL SENTENCE
  ==================================================

  Keeps:
    - sentence id
    - original creation time
    - order
    - speaker

  Replaces:
    - original input
    - detected input kind
    - English
    - Japanese
    - breakdown segments

  A sentence currently inside a paragraph should
  normally be broken out first. This function blocks
  grouped editing unless allowGroupedEdit=true is
  explicitly supplied.
  ==================================================
  */

  async function updateManual(
    existingSentence,
    input,
    options
  ) {
    const Model = getModel();

    if (
      !existingSentence ||
      existingSentence.type !==
        Model.UNIT_TYPES.SENTENCE
    ) {
      throw new Error(
        "A valid existing sentence is required."
      );
    }

    const data = input || {};

    if (
      existingSentence.paragraphId &&
      data.allowGroupedEdit !== true
    ) {
      throw new Error(
        "Break down the paragraph before editing this sentence."
      );
    }

    const result = await processManual(
      {
        id: existingSentence.id,
        direction: data.direction,
        speaker: existingSentence.speaker,
        text: data.text,
        order: existingSentence.order,
        paragraphId:
          data.allowGroupedEdit === true
            ? existingSentence.paragraphId
            : null,
        createdAt: existingSentence.createdAt,
        updatedAt: new Date().toISOString()
      },
      options
    );

    return result;
  }


  /*
  ==================================================
  CREATE SENTENCE FROM AI NEXT-TURN OUTPUT
  ==================================================

  next_turn already returns:

    {
      speaker,
      linguisticData: {
        english,
        japanese,
        segments
      }
    }

  This function converts that into the same Sentence
  object used everywhere else.
  ==================================================
  */

  function createFromAI(input) {
    const Model = getModel();
    const data = input || {};

    if (!Model.isSpeaker(data.speaker)) {
      throw new Error(
        "AI sentence requires a valid speaker."
      );
    }

    const linguistic =
      Model.normalizeLinguisticData(
        data.linguisticData || data
      );

    return Model.createSentence({
      id: data.id,
      order: normalizeOrder(data.order, 0),
      speaker: data.speaker,
      origin: Model.ORIGINS.AI,
      originalInput: "",
      inputKind: Model.INPUT_KINDS.UNKNOWN,
      english: linguistic.english,
      japanese: linguistic.japanese,
      segments: linguistic.segments,
      paragraphId: data.paragraphId || null,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt
    });
  }


  /*
  ==================================================
  ACCEPT AN OPTION AS A REAL SENTENCE
  ==================================================

  Options are temporary learning suggestions.
  Pressing "Use" can call this function to turn one
  into a real conversation sentence.

  The accepted sentence is treated as manual/user-
  chosen content rather than AI conversation output,
  even though the Option itself may have been AI-
  generated.
  ==================================================
  */

  function createFromOption(input) {
    const Model = getModel();
    const data = input || {};

    if (!Model.isSpeaker(data.speaker)) {
      throw new Error(
        "Accepted Option requires a valid speaker."
      );
    }

    const option = data.option || {};

    const linguistic =
      Model.normalizeLinguisticData(option);

    return Model.createSentence({
      order: normalizeOrder(data.order, 0),
      speaker: data.speaker,
      origin: Model.ORIGINS.AI,
      originalInput:
        Model.sentenceTargetText(
          linguistic,
          data.direction
        ) || linguistic.english,
      inputKind:
        data.direction === Model.DIRECTIONS.EN_JA
          ? Model.INPUT_KINDS.JAPANESE
          : Model.INPUT_KINDS.ENGLISH,
      english: linguistic.english,
      japanese: linguistic.japanese,
      segments: linguistic.segments,
      paragraphId: null
    });
  }


  /*
  ==================================================
  BUILD CLEAN AI HISTORY
  ==================================================

  Paragraphs and Options must never enter the
  conversation history. Only canonical Sentence
  records are included, ordered by sentence.order.
  ==================================================
  */

  function buildHistory(sentences) {
    const Model = getModel();

    return Model.sortByOrder(
      Array.isArray(sentences)
        ? sentences.filter(function (item) {
            return (
              item &&
              item.type === Model.UNIT_TYPES.SENTENCE
            );
          })
        : []
    ).map(Model.toHistoryItem);
  }


  /*
  ==================================================
  NEXT ORDER
  ==================================================

  Gives a simple stable number for newly appended
  conversation sentences.

  This does not reorder existing sentences.
  ==================================================
  */

  function getNextOrder(sentences) {
    const Model = getModel();

    const realSentences = Array.isArray(sentences)
      ? sentences.filter(function (item) {
          return (
            item &&
            item.type === Model.UNIT_TYPES.SENTENCE
          );
        })
      : [];

    if (!realSentences.length) {
      return 1;
    }

    const highest = realSentences.reduce(
      function (max, sentence) {
        const order = Number(sentence.order);

        return Number.isFinite(order)
          ? Math.max(max, order)
          : max;
      },
      0
    );

    return highest + 1;
  }


  /*
  ==================================================
  GENERATE THE NEXT AI SENTENCE
  ==================================================

  Convenience wrapper used later by app.js:

    const result = await ConversateSentence
      .generateNextAI({
        direction,
        sentences
      });

  The server decides the next speaker from the real
  conversation history:

    user    -> partner
    partner -> user

  Empty history starts with partner.
  ==================================================
  */

  async function generateNextAI(input, options) {
    const Model = getModel();
    const AI = getAI();
    const data = input || {};

    if (!Model.isDirection(data.direction)) {
      throw new Error(
        "A valid direction is required."
      );
    }

    const sentences = Array.isArray(data.sentences)
      ? data.sentences
      : [];

    const history = buildHistory(sentences);

    const result = await AI.nextTurn(
      {
        direction: data.direction,
        history
      },
      options
    );

    return createFromAI({
      speaker: result.speaker,
      linguisticData: result.linguisticData,
      order: getNextOrder(sentences)
    });
  }


  global.ConversateSentence = Object.freeze({
    processManual,
    updateManual,
    createFromAI,
    createFromOption,
    buildHistory,
    getNextOrder,
    generateNextAI
  });

})(window);
