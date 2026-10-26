(function (global) {
  "use strict";

  const API_ENDPOINT = "/api/ai";

  function getModel() {
    const model = global.ConversateModel;

    if (!model) {
      throw new Error("model.js must be loaded before ai.js.");
    }

    return model;
  }

  function notify(onStatus, message) {
    if (typeof onStatus === "function") {
      onStatus(message || "");
    }
  }

  async function request(task, data, options) {
    const settings = options || {};

    notify(settings.onStatus, "Working...");

    let response;

    try {
      response = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          task,
          data
        }),
        signal: settings.signal
      });
    } catch (error) {
      notify(settings.onStatus, "");

      if (error?.name === "AbortError") {
        throw error;
      }

      throw new Error("Could not reach the AI service.");
    }

    let payload;

    try {
      payload = await response.json();
    } catch (error) {
      notify(settings.onStatus, "");
      throw new Error("The AI service returned an invalid response.");
    }

    if (!response.ok || payload?.success !== true) {
      notify(settings.onStatus, "");
      throw new Error(
        payload?.error ||
        "The AI request failed."
      );
    }

    notify(settings.onStatus, "");
    return payload.result;
  }

  function normalizeLinguisticResult(result) {
    const Model = getModel();

    return Model.normalizeLinguisticData({
      english: result?.english,
      japanese: result?.japanese,
      segments: result?.segments
    });
  }

  async function processSentence(input, options) {
    const Model = getModel();
    const data = input || {};

    if (!Model.isDirection(data.direction)) {
      throw new Error("A valid direction is required.");
    }

    const text = Model.cleanMultilineText(data.text);

    if (!text) {
      throw new Error("Enter one sentence.");
    }

    const result = await request(
      "process_sentence",
      {
        direction: data.direction,
        text
      },
      options
    );

    if (result?.valid !== true) {
      return {
        valid: false,
        message:
          Model.cleanText(result?.message) ||
          "Please enter one sentence at a time.",
        inputKind:
          Object.values(Model.INPUT_KINDS).includes(result?.inputKind)
            ? result.inputKind
            : Model.INPUT_KINDS.UNKNOWN,
        linguisticData: null
      };
    }

    return {
      valid: true,
      message: "",
      inputKind:
        Object.values(Model.INPUT_KINDS).includes(result?.inputKind)
          ? result.inputKind
          : Model.INPUT_KINDS.UNKNOWN,
      linguisticData: normalizeLinguisticResult(result)
    };
  }

  async function nextTurn(input, options) {
    const Model = getModel();
    const data = input || {};

    if (!Model.isDirection(data.direction)) {
      throw new Error("A valid direction is required.");
    }

    const history = Array.isArray(data.history)
      ? data.history.map(function (item) {
          return {
            speaker: Model.isSpeaker(item?.speaker)
              ? item.speaker
              : Model.SPEAKERS.USER,
            english: Model.cleanText(item?.english),
            japanese: Model.cleanText(item?.japanese)
          };
        })
      : [];

    const result = await request(
      "next_turn",
      {
        direction: data.direction,
        history
      },
      options
    );

    if (!Model.isSpeaker(result?.speaker)) {
      throw new Error("AI returned an invalid speaker.");
    }

    return {
      speaker: result.speaker,
      linguisticData: normalizeLinguisticResult(result)
    };
  }

  async function generateOptions(input, options) {
    const Model = getModel();
    const data = input || {};

    if (!Model.isDirection(data.direction)) {
      throw new Error("A valid direction is required.");
    }

    const sentence = Model.normalizeLinguisticData(data.sentence || {});

    const result = await request(
      "generate_options",
      {
        direction: data.direction,
        sentence
      },
      options
    );

    const rawOptions = Array.isArray(result?.options)
      ? result.options
      : [];

    if (rawOptions.length !== 3) {
      throw new Error("AI did not return exactly three options.");
    }

    return rawOptions.map(normalizeLinguisticResult);
  }

  async function buildParagraph(input, options) {
    const Model = getModel();
    const data = input || {};

    if (!Model.isDirection(data.direction)) {
      throw new Error("A valid direction is required.");
    }

    const sentences = Array.isArray(data.sentences)
      ? data.sentences.map(function (sentence, index) {
          const linguistic = Model.normalizeLinguisticData(sentence);

          return {
            order: Number.isFinite(Number(sentence?.order))
              ? Number(sentence.order)
              : index,
            english: linguistic.english,
            japanese: linguistic.japanese
          };
        })
      : [];

    if (sentences.length < 2) {
      throw new Error("Select at least two sentences.");
    }

    const result = await request(
      "build_paragraph",
      {
        direction: data.direction,
        sentences
      },
      options
    );

    return normalizeLinguisticResult(result);
  }

  async function teach(input, options) {
    const Model = getModel();
    const data = input || {};

    if (!Model.isDirection(data.direction)) {
      throw new Error("A valid direction is required.");
    }

    const item = Model.normalizeLinguisticData(data.item || {});

    const result = await request(
      "teach",
      {
        direction: data.direction,
        item
      },
      options
    );

    const explanation = Model.cleanMultilineText(result?.explanation);

    if (!explanation) {
      throw new Error("Teach returned no explanation.");
    }

    return {
      explanation
    };
  }

  global.ConversateAI = Object.freeze({
    endpoint: API_ENDPOINT,
    request,
    processSentence,
    nextTurn,
    generateOptions,
    buildParagraph,
    teach
  });
})(window);
