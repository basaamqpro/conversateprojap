(function (global) {
  "use strict";

  /*
  ==================================================
  CONVERSATE PRO JAPANESE — PARAGRAPH SERVICE
  ==================================================

  This module keeps paragraph composition separate from the UI.

  Rules:
    - A paragraph is made from at least two real sentences.
    - Selected sentences are always ordered by their stable `order` value.
    - Existing paragraphs are flattened to their original sentence IDs.
    - AI receives the full ordered sentence set and creates one fresh
      paragraph translation/breakdown.
    - Paragraphs never nest.
    - The original sentence records remain canonical conversation history.
  ==================================================
  */

  const UNIT_TYPES = Object.freeze({
    SENTENCE: "sentence",
    PARAGRAPH: "paragraph"
  });

  function getModel() {
    if (!global.ConversateModel) {
      throw new Error("model.js must be loaded before paragraph.js.");
    }

    return global.ConversateModel;
  }

  function getAI() {
    if (!global.ConversateAI) {
      throw new Error("ai.js must be loaded before paragraph.js.");
    }

    return global.ConversateAI;
  }

  function cleanUnitRef(value) {
    const type = value?.type;
    const id = String(value?.id || "").trim();

    if (
      (type !== UNIT_TYPES.SENTENCE && type !== UNIT_TYPES.PARAGRAPH) ||
      !id
    ) {
      throw new Error("Invalid paragraph selection.");
    }

    return { type, id };
  }

  function normalizeLoadedParagraphs(paragraphs) {
    const Model = getModel();

    return (Array.isArray(paragraphs) ? paragraphs : [])
      .map(function (paragraph) {
        try {
          return Model.createParagraph(paragraph);
        } catch (error) {
          console.warn("Skipping invalid saved paragraph:", paragraph, error);
          return null;
        }
      })
      .filter(Boolean);
  }

  function getParagraphById(paragraphs, paragraphId) {
    return (Array.isArray(paragraphs) ? paragraphs : []).find(function (item) {
      return item.id === paragraphId;
    }) || null;
  }

  function getSentenceById(sentences, sentenceId) {
    return (Array.isArray(sentences) ? sentences : []).find(function (item) {
      return item.id === sentenceId;
    }) || null;
  }

  function getParagraphChildren(paragraph, sentences) {
    const Model = getModel();
    const ids = new Set(Array.isArray(paragraph?.sentenceIds)
      ? paragraph.sentenceIds
      : []);

    return Model.sortByOrder(
      (Array.isArray(sentences) ? sentences : []).filter(function (sentence) {
        return ids.has(sentence.id);
      })
    );
  }

  function getVisibleUnits(sentences, paragraphs) {
    const Model = getModel();
    const orderedSentences = Model.sortByOrder(sentences);
    const paragraphMap = new Map(
      (Array.isArray(paragraphs) ? paragraphs : []).map(function (paragraph) {
        return [paragraph.id, paragraph];
      })
    );
    const renderedParagraphs = new Set();
    const units = [];

    orderedSentences.forEach(function (sentence) {
      const paragraph = sentence.paragraphId
        ? paragraphMap.get(sentence.paragraphId)
        : null;

      if (!paragraph) {
        units.push(sentence);
        return;
      }

      if (!renderedParagraphs.has(paragraph.id)) {
        renderedParagraphs.add(paragraph.id);
        units.push(paragraph);
      }
    });

    // If a paragraph exists but its sentence links are temporarily missing,
    // keep it visible rather than silently losing it from the page.
    (Array.isArray(paragraphs) ? paragraphs : []).forEach(function (paragraph) {
      if (!renderedParagraphs.has(paragraph.id)) {
        units.push(paragraph);
      }
    });

    return Model.sortByOrder(units);
  }

  function flattenSelection(unitRefs, sentences, paragraphs) {
    const Model = getModel();
    const refs = (Array.isArray(unitRefs) ? unitRefs : []).map(cleanUnitRef);

    if (refs.length < 2) {
      throw new Error("Select two sentences or paragraphs to join.");
    }

    const sentenceIds = [];
    const replacedParagraphIds = [];

    refs.forEach(function (ref) {
      if (ref.type === UNIT_TYPES.SENTENCE) {
        const sentence = getSentenceById(sentences, ref.id);

        if (!sentence) {
          throw new Error("One of the selected sentences could not be found.");
        }

        sentenceIds.push(sentence.id);
        return;
      }

      const paragraph = getParagraphById(paragraphs, ref.id);

      if (!paragraph) {
        throw new Error("One of the selected paragraphs could not be found.");
      }

      replacedParagraphIds.push(paragraph.id);
      paragraph.sentenceIds.forEach(function (sentenceId) {
        sentenceIds.push(sentenceId);
      });
    });

    const uniqueIds = Array.from(new Set(sentenceIds));
    const selectedSentences = uniqueIds
      .map(function (sentenceId) {
        return getSentenceById(sentences, sentenceId);
      })
      .filter(Boolean);

    const orderedSentences = Model.sortByOrder(selectedSentences);

    if (orderedSentences.length < 2) {
      throw new Error("A paragraph needs at least two different sentences.");
    }

    if (orderedSentences.length !== uniqueIds.length) {
      throw new Error("Some paragraph sentences could not be found.");
    }

    return {
      sentences: orderedSentences,
      sentenceIds: orderedSentences.map(function (sentence) {
        return sentence.id;
      }),
      replacedParagraphIds: Array.from(new Set(replacedParagraphIds))
    };
  }

  async function build(input, options) {
    const Model = getModel();
    const AI = getAI();
    const data = input || {};

    if (!Model.isDirection(data.direction)) {
      throw new Error("A valid conversation direction is required.");
    }

    const flattened = flattenSelection(
      data.units,
      data.sentences,
      data.paragraphs
    );

    const linguistic = await AI.buildParagraph(
      {
        direction: data.direction,
        sentences: flattened.sentences
      },
      options
    );

    const anchorOrder = Math.min.apply(
      null,
      flattened.sentences.map(function (sentence) {
        return Number(sentence.order || 0);
      })
    );

    const paragraph = Model.createParagraph({
      id: Model.createId("paragraph"),
      sentenceIds: flattened.sentenceIds,
      anchorOrder,
      english: linguistic.english,
      japanese: linguistic.japanese,
      segments: linguistic.segments
    });

    return {
      paragraph,
      sentences: flattened.sentences,
      replacedParagraphIds: flattened.replacedParagraphIds
    };
  }

  function getTargetText(paragraph, direction) {
    const Model = getModel();
    const config = Model.getDirectionConfig(direction);

    return config.targetIsJapanese
      ? Model.cleanText(paragraph?.japanese)
      : Model.cleanText(paragraph?.english);
  }

  function getSourceText(paragraph, direction) {
    const Model = getModel();
    const config = Model.getDirectionConfig(direction);

    return config.targetIsJapanese
      ? Model.cleanText(paragraph?.english)
      : Model.cleanText(paragraph?.japanese);
  }

  global.ConversateParagraph = Object.freeze({
    UNIT_TYPES,
    normalizeLoadedParagraphs,
    getParagraphById,
    getParagraphChildren,
    getVisibleUnits,
    flattenSelection,
    build,
    getTargetText,
    getSourceText
  });
})(window);
