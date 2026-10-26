(function (global) {
  "use strict";

  /*
  ==================================================
  CONVERSATE PRO JAPANESE
  CONVERSATION UI + FIRESTORE PERSISTENCE
  ==================================================

  This controller handles:

    - English → Japanese / Japanese → English direction
    - manual You / Partner sentences
    - AI next-turn generation
    - rendering sentence breakdowns
    - editing
    - deleting
    - paragraph joining / breakdown
    - loading/saving the active user's room in Firestore

  Later modules can still add:

    - Options
    - Teach
    - Audio

  without changing the Sentence data contract.
  ==================================================
  */

  const SEGMENT_COLORS = [
    "#0a66ff",
    "#7c3aed",
    "#0f9f6e",
    "#d97706",
    "#db2777",
    "#0891b2",
    "#4f46e5",
    "#65a30d"
  ];

  const state = {
    room: null,
    direction: "en-ja",
    speaker: "user",
    sentences: [],
    paragraphs: [],
    joinSelection: null,
    editingId: null,
    activeController: null,
    busy: false,
    firebase: null
  };

  const el = {};
  let firebasePromise = null;

  function getModel() {
    if (!global.ConversateModel) {
      throw new Error("model.js must be loaded before app.js.");
    }

    return global.ConversateModel;
  }

  function getSentenceController() {
    if (!global.ConversateSentence) {
      throw new Error("sentence.js must be loaded before app.js.");
    }

    return global.ConversateSentence;
  }

  function getParagraphController() {
    if (!global.ConversateParagraph) {
      throw new Error("paragraph.js must be loaded before app.js.");
    }

    return global.ConversateParagraph;
  }

  async function getFirebase() {
    if (state.firebase) {
      return state.firebase;
    }

    if (!firebasePromise) {
      firebasePromise = import("./firebase.js");
    }

    state.firebase = await firebasePromise;
    return state.firebase;
  }

  function cacheElements() {
    el.conversation = document.getElementById("conversation");
    el.status = document.getElementById("status");
    el.input = document.getElementById("sentenceInput");
    el.sendButton = document.getElementById("sendButton");
    el.aiButton = document.getElementById("aiButton");
    el.cancelEditButton = document.getElementById("cancelEditButton");
    el.speakerUser = document.getElementById("speakerUser");
    el.speakerPartner = document.getElementById("speakerPartner");
    el.directionEnJa = document.getElementById("directionEnJa");
    el.directionJaEn = document.getElementById("directionJaEn");
    el.composerHint = document.getElementById("composerHint");
    el.roomName = document.getElementById("roomName");
  }

  function setStatus(message, type) {
    el.status.textContent = message || "";
    el.status.className = "status";

    if (type === "error") {
      el.status.classList.add("error");
    }
  }

  function setBusy(busy) {
    state.busy = Boolean(busy);

    el.sendButton.disabled = state.busy;
    el.aiButton.disabled = state.busy || Boolean(state.editingId);
    el.speakerUser.disabled = state.busy;
    el.speakerPartner.disabled = state.busy;
    el.directionEnJa.disabled = state.busy;
    el.directionJaEn.disabled = state.busy;
    el.cancelEditButton.disabled = state.busy;

    if (!state.busy) {
      updateSendButtonText();
    }
  }

  function updateSendButtonText() {
    el.sendButton.textContent = state.editingId
      ? "Update"
      : "Send";
  }

  function abortActiveRequest() {
    if (state.activeController) {
      state.activeController.abort();
      state.activeController = null;
    }
  }

  function createController() {
    abortActiveRequest();

    const controller = new AbortController();
    state.activeController = controller;

    return controller;
  }

  function finishController(controller) {
    if (state.activeController === controller) {
      state.activeController = null;
    }
  }

  function normalizeLoadedSentences(sentences) {
    const Model = getModel();

    return (Array.isArray(sentences) ? sentences : [])
      .map(function (sentence) {
        try {
          return Model.createSentence(sentence);
        } catch (error) {
          console.warn("Skipping invalid saved sentence:", sentence, error);
          return null;
        }
      })
      .filter(Boolean);
  }

  function normalizeLoadedParagraphs(paragraphs) {
    return getParagraphController().normalizeLoadedParagraphs(paragraphs);
  }

  function clearJoinSelection() {
    state.joinSelection = null;
  }

  function unitIsSelected(type, id) {
    return Boolean(
      state.joinSelection &&
      state.joinSelection.type === type &&
      state.joinSelection.id === id
    );
  }

  function setSpeaker(speaker) {
    const Model = getModel();

    if (!Model.isSpeaker(speaker)) {
      return;
    }

    state.speaker = speaker;

    const userActive = speaker === Model.SPEAKERS.USER;

    el.speakerUser.classList.toggle("active", userActive);
    el.speakerUser.setAttribute("aria-pressed", String(userActive));

    el.speakerPartner.classList.toggle("active", !userActive);
    el.speakerPartner.setAttribute("aria-pressed", String(!userActive));
  }

  function setDirection(direction) {
    const Model = getModel();

    if (!Model.isDirection(direction)) {
      return;
    }

    state.direction = direction;

    const enJa = direction === Model.DIRECTIONS.EN_JA;

    el.directionEnJa.classList.toggle("active", enJa);
    el.directionEnJa.setAttribute("aria-pressed", String(enJa));

    el.directionJaEn.classList.toggle("active", !enJa);
    el.directionJaEn.setAttribute("aria-pressed", String(!enJa));

    el.input.dir = "ltr";
    el.input.placeholder = enJa
      ? "Write one sentence in English, Japanese, or transliteration…"
      : "Write one sentence in Japanese, English, or transliteration…";

    el.composerHint.textContent = enJa
      ? "Target: Japanese. English, Japanese, transliteration, and approximate pronunciation are accepted."
      : "Target: English. Japanese, English, transliteration, and approximate pronunciation are accepted.";

    renderConversation();
  }

  async function changeDirection(direction) {
    if (state.busy || !state.room || direction === state.direction) {
      return;
    }

    const Firebase = await getFirebase();
    const previousDirection = state.direction;

    clearJoinSelection();
    setDirection(direction);
    setBusy(true);
    setStatus("Saving room direction…");

    try {
      const updatedRoom = await Firebase.updateRoom(state.room.id, { direction });
      state.room = getModel().createRoom(updatedRoom);
      setStatus("");
    } catch (error) {
      console.error(error);
      setDirection(previousDirection);
      setStatus(error?.message || "Could not save the room direction.", "error");
    } finally {
      setBusy(false);
    }
  }

  function createEmptyState() {
    const wrapper = document.createElement("div");
    wrapper.className = "empty_state";

    const icon = document.createElement("div");
    icon.className = "empty_icon";
    icon.textContent = "あ";

    const heading = document.createElement("h2");
    heading.textContent = "Build the conversation one sentence at a time";

    const text = document.createElement("p");
    text.textContent =
      "Choose You or Partner and write a sentence yourself, or press AI next turn whenever you want the AI to continue from the opposite position.";

    wrapper.append(icon, heading, text);

    return wrapper;
  }


  function normalizeDictionaryText(text) {
    return String(text || "")
      .trim()
      .normalize("NFKC")
      .toLocaleLowerCase("en")
      .replace(/[.!?,:;"'“”‘’()\[\]{}]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenizeEnglish(text) {
    return String(text || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function preserveWordPunctuation(original, replacement) {
    const source = String(original || "");
    let next = String(replacement || "").trim();

    if (!next) return next;

    const match = source.match(/^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/);
    if (!match) return next;

    if (/^[A-Z]/.test(match[2] || "") && next) {
      next = next.charAt(0).toUpperCase() + next.slice(1);
    }

    return match[1] + next + match[3];
  }

  function buildEditedEnglishText(segments, segmentIndex, wordIndex, replacement) {
    const safeSegments = Array.isArray(segments) ? segments : [];
    const nextWord = String(replacement || "").trim();

    if (!nextWord) {
      throw new Error("That dictionary item does not contain an English word.");
    }

    return safeSegments
      .map(function (segment, index) {
        const english = String(segment?.english || "").trim();

        if (index !== segmentIndex) {
          return english;
        }

        const words = tokenizeEnglish(english);

        if (!words[wordIndex]) {
          throw new Error("The selected English word could not be found.");
        }

        words[wordIndex] = preserveWordPunctuation(words[wordIndex], nextWord);
        return words.join(" ");
      })
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  function segmentMatchScore(a, b) {
    if (!a || !b) return 0;

    const aEn = normalizeDictionaryText(a.english);
    const bEn = normalizeDictionaryText(b.english);

    if (!aEn || !bEn) return 0;
    if (aEn === bEn) return 8;
    if (aEn.includes(bEn) || bEn.includes(aEn)) return 4;

    return 0;
  }

  function findParagraphChildWord(paragraph, paragraphSegment, clickedWord, preferredWordIndex) {
    const Paragraph = getParagraphController();
    const children = Paragraph.getParagraphChildren(paragraph, state.sentences);
    const needle = normalizeDictionaryText(clickedWord);
    let best = null;

    children.forEach(function (sentence) {
      sentence.segments.forEach(function (segment, segmentIndex) {
        const words = tokenizeEnglish(segment.english);

        words.forEach(function (word, wordIndex) {
          if (normalizeDictionaryText(word) !== needle) {
            return;
          }

          let score = 10 + segmentMatchScore(paragraphSegment, segment);
          if (wordIndex === preferredWordIndex) score += 1;

          if (!best || score > best.score) {
            best = {
              sentence,
              segmentIndex,
              wordIndex,
              score
            };
          }
        });
      });
    });

    return best;
  }

  function openBreakdownDictionary(button) {
    const unitType = button.dataset.unitType;
    const unitId = button.dataset.unitId;
    const segmentIndex = Number(button.dataset.segmentIndex);
    const wordIndex = Number(button.dataset.wordIndex);

    let unit = null;

    if (unitType === "sentence") {
      unit = state.sentences.find(function (item) {
        return item.id === unitId;
      });
    } else if (unitType === "paragraph") {
      unit = state.paragraphs.find(function (item) {
        return item.id === unitId;
      });
    }

    const segment = unit?.segments?.[segmentIndex];

    if (!unit || !segment || !Number.isInteger(wordIndex)) {
      return;
    }

    if (
      global.ConversateDictionaryUI &&
      typeof global.ConversateDictionaryUI.openBreakdown === "function"
    ) {
      global.ConversateDictionaryUI.openBreakdown({
        unitType,
        unitId,
        segmentIndex,
        wordIndex,
        clickedText: button.textContent || "",
        segment: Object.assign({}, segment)
      });
    }
  }

  async function replaceBreakdownSegment(context, vocab) {
    if (state.busy || !state.room) {
      return false;
    }

    const Model = getModel();
    const Sentence = getSentenceController();
    const Paragraph = getParagraphController();
    const Firebase = await getFirebase();
    const segmentIndex = Number(context?.segmentIndex);
    const wordIndex = Number(context?.wordIndex);
    const replacement = String(vocab?.en || "").trim();
    const controller = createController();

    if (
      !Number.isInteger(segmentIndex) || segmentIndex < 0 ||
      !Number.isInteger(wordIndex) || wordIndex < 0
    ) {
      throw new Error("The selected English word could not be identified.");
    }

    if (!replacement) {
      throw new Error("That dictionary item does not contain an English word.");
    }

    setBusy(true);
    setStatus("Editing the sentence and rebuilding the Japanese breakdown…");

    try {
      if (context.unitType === "sentence") {
        const existing = state.sentences.find(function (item) {
          return item.id === context.unitId;
        });

        if (!existing) {
          throw new Error("That sentence could not be found.");
        }

        const text = buildEditedEnglishText(
          existing.segments,
          segmentIndex,
          wordIndex,
          replacement
        );

        const result = await Sentence.updateManual(
          existing,
          {
            direction: state.direction,
            text,
            allowGroupedEdit: Boolean(existing.paragraphId)
          },
          {
            signal: controller.signal,
            onStatus: function (message) {
              if (message) setStatus(message);
            }
          }
        );

        if (result.valid !== true) {
          throw new Error(result.message || "The updated sentence could not be processed.");
        }

        const saved = Model.createSentence(
          await Firebase.saveSentence(state.room.id, result.sentence)
        );

        state.sentences = state.sentences.map(function (item) {
          return item.id === saved.id ? saved : item;
        });

        setStatus("");
        renderConversation();
        return true;
      }

      if (context.unitType === "paragraph") {
        const paragraph = Paragraph.getParagraphById(
          state.paragraphs,
          context.unitId
        );

        if (!paragraph) {
          throw new Error("That paragraph could not be found.");
        }

        const paragraphSegment = paragraph.segments[segmentIndex];
        const match = findParagraphChildWord(
          paragraph,
          paragraphSegment,
          context.clickedText,
          wordIndex
        );

        if (!match) {
          throw new Error(
            "That English word could not be found in the paragraph's original sentences."
          );
        }

        const childText = buildEditedEnglishText(
          match.sentence.segments,
          match.segmentIndex,
          match.wordIndex,
          replacement
        );

        const childResult = await Sentence.updateManual(
          match.sentence,
          {
            direction: state.direction,
            text: childText,
            allowGroupedEdit: true
          },
          {
            signal: controller.signal,
            onStatus: function (message) {
              if (message) setStatus(message);
            }
          }
        );

        if (childResult.valid !== true) {
          throw new Error(childResult.message || "The updated sentence could not be processed.");
        }

        const updatedChild = Model.createSentence(childResult.sentence);
        const childIds = new Set(paragraph.sentenceIds);
        const rebuiltChildren = Model.sortByOrder(
          state.sentences
            .filter(function (sentence) {
              return childIds.has(sentence.id);
            })
            .map(function (sentence) {
              return sentence.id === updatedChild.id
                ? updatedChild
                : sentence;
            })
        );

        if (rebuiltChildren.length !== paragraph.sentenceIds.length) {
          throw new Error("Some paragraph sentences could not be loaded.");
        }

        setStatus("Rebuilding the Japanese paragraph with the edited sentence…");

        const linguistic = await global.ConversateAI.buildParagraph(
          {
            direction: state.direction,
            sentences: rebuiltChildren
          },
          {
            signal: controller.signal,
            onStatus: function (message) {
              if (message) setStatus(message);
            }
          }
        );

        const updatedParagraph = Model.createParagraph({
          id: paragraph.id,
          sentenceIds: paragraph.sentenceIds,
          anchorOrder: paragraph.anchorOrder,
          english: linguistic.english,
          japanese: linguistic.japanese,
          segments: linguistic.segments,
          createdAt: paragraph.createdAt,
          updatedAt: new Date().toISOString()
        });

        const savedPair = await Firebase.saveSentenceAndParagraph(
          state.room.id,
          updatedChild,
          updatedParagraph
        );

        const savedSentence = Model.createSentence(savedPair.sentence);
        const savedParagraph = Model.createParagraph(savedPair.paragraph);

        state.sentences = state.sentences.map(function (item) {
          return item.id === savedSentence.id ? savedSentence : item;
        });

        state.paragraphs = state.paragraphs.map(function (item) {
          return item.id === savedParagraph.id ? savedParagraph : item;
        });

        setStatus("");
        renderConversation();
        return true;
      }

      throw new Error("Unsupported breakdown item.");
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error(error);
        setStatus(error?.message || "Could not update the selected word.", "error");
      }
      return false;
    } finally {
      finishController(controller);
      setBusy(false);
    }
  }

  function createSegment(segment, index, context) {
    const Model = getModel();
    const enJa = state.direction === Model.DIRECTIONS.EN_JA;

    const group = document.createElement("div");
    group.className = "segment";
    group.style.setProperty(
      "--segment-accent",
      SEGMENT_COLORS[index % SEGMENT_COLORS.length]
    );

    function makePlainLine(className, text, japanese) {
      const line = document.createElement("span");
      line.className = "segment_line " + className;
      line.textContent = text || "\u00A0";
      line.dir = "ltr";

      if (japanese) {
        line.classList.add("japanese");
        line.lang = "ja";
      }

      return line;
    }

    function makeEnglishLine(className, text) {
      const line = document.createElement("span");
      line.className = "segment_line " + className + " segment_english_line";
      line.dir = "ltr";

      const words = tokenizeEnglish(text);

      if (!words.length) {
        line.textContent = "\u00A0";
        return line;
      }

      words.forEach(function (word, wordIndex) {
        if (wordIndex > 0) {
          line.appendChild(document.createTextNode(" "));
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "breakdown_english_word";
        button.textContent = word;
        button.dataset.dictionaryBreakdown = "true";
        button.dataset.unitType = context.type;
        button.dataset.unitId = context.id;
        button.dataset.segmentIndex = String(index);
        button.dataset.wordIndex = String(wordIndex);
        button.title = "Show related Japanese dictionary words";

        line.appendChild(button);
      });

      return line;
    }

    const pronunciation = makePlainLine(
      "segment_pronunciation",
      segment.transliteration,
      false
    );

    const target = enJa
      ? makePlainLine("segment_target", segment.japanese, true)
      : makeEnglishLine("segment_target", segment.english);

    const source = enJa
      ? makeEnglishLine("segment_source", segment.english)
      : makePlainLine("segment_source", segment.japanese, true);

    group.append(pronunciation, target, source);
    return group;
  }

  function createJoinButton(type, id) {
    const selected = unitIsSelected(type, id);
    const button = document.createElement("button");

    button.type = "button";
    button.className = "message_action join_action";
    button.classList.toggle("selected", selected);
    button.textContent = selected ? "✓" : "+";
    button.title = selected
      ? "Cancel paragraph selection"
      : "Join with another sentence or paragraph";
    button.setAttribute(
      "aria-label",
      selected
        ? "Cancel paragraph selection"
        : "Select for paragraph"
    );
    button.dataset.action = "join";
    button.dataset.unitType = type;
    button.dataset.unitId = id;

    return button;
  }

  function createSentenceCard(sentence) {
    const Model = getModel();
    const Paragraph = getParagraphController();
    const enJa = state.direction === Model.DIRECTIONS.EN_JA;

    const row = document.createElement("article");
    row.className = "message_row " + sentence.speaker;
    row.dataset.sentenceId = sentence.id;

    const card = document.createElement("div");
    card.className = "message_card";

    const meta = document.createElement("div");
    meta.className = "message_meta";

    const speaker = document.createElement("span");
    speaker.textContent = sentence.speaker === Model.SPEAKERS.USER
      ? "You"
      : "Partner";

    meta.appendChild(speaker);

    if (sentence.origin === Model.ORIGINS.AI) {
      const origin = document.createElement("span");
      origin.className = "origin_badge";
      origin.textContent = "AI";
      meta.appendChild(origin);
    }

    const bubble = document.createElement("div");
    bubble.className = "message_bubble";

    const summary = document.createElement("div");
    summary.className = "sentence_summary";

    const target = document.createElement("p");
    target.className = "target_sentence";
    target.textContent = Model.sentenceTargetText(sentence, state.direction);

    const source = document.createElement("p");
    source.className = "source_sentence";
    source.textContent = Model.sentenceSourceText(sentence, state.direction);

    if (enJa) {
      target.classList.add("japanese");
      target.dir = "ltr";
    } else {
      source.classList.add("japanese");
      source.dir = "ltr";
    }

    summary.append(target, source);

    const breakdown = document.createElement("div");
    breakdown.className = "breakdown";

    sentence.segments.forEach(function (segment, index) {
      breakdown.appendChild(createSegment(segment, index, {
        type: Paragraph.UNIT_TYPES.SENTENCE,
        id: sentence.id
      }));
    });

    const actions = document.createElement("div");
    actions.className = "message_actions";

    const join = createJoinButton(Paragraph.UNIT_TYPES.SENTENCE, sentence.id);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "message_action";
    edit.textContent = "Edit";
    edit.dataset.action = "edit";
    edit.dataset.sentenceId = sentence.id;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "message_action delete";
    remove.textContent = "Delete";
    remove.dataset.action = "delete";
    remove.dataset.sentenceId = sentence.id;

    actions.append(join, edit, remove);
    bubble.append(summary, breakdown, actions);
    card.append(meta, bubble);
    row.appendChild(card);

    return row;
  }

  function createParagraphCard(paragraph) {
    const Model = getModel();
    const Paragraph = getParagraphController();
    const enJa = state.direction === Model.DIRECTIONS.EN_JA;
    const children = Paragraph.getParagraphChildren(paragraph, state.sentences);

    const row = document.createElement("article");
    row.className = "paragraph_row";
    row.dataset.paragraphId = paragraph.id;

    const card = document.createElement("div");
    card.className = "paragraph_card";

    const meta = document.createElement("div");
    meta.className = "paragraph_meta";

    const title = document.createElement("span");
    title.textContent = "Paragraph";

    const count = document.createElement("span");
    count.className = "paragraph_count";
    count.textContent = children.length + (children.length === 1 ? " sentence" : " sentences");

    meta.append(title, count);

    const bubble = document.createElement("div");
    bubble.className = "paragraph_bubble";

    const summary = document.createElement("div");
    summary.className = "sentence_summary paragraph_summary";

    const target = document.createElement("p");
    target.className = "target_sentence";
    target.textContent = Paragraph.getTargetText(paragraph, state.direction);

    const source = document.createElement("p");
    source.className = "source_sentence";
    source.textContent = Paragraph.getSourceText(paragraph, state.direction);

    if (enJa) {
      target.classList.add("japanese");
      target.dir = "ltr";
    } else {
      source.classList.add("japanese");
      source.dir = "ltr";
    }

    summary.append(target, source);

    const breakdown = document.createElement("div");
    breakdown.className = "breakdown paragraph_breakdown";

    paragraph.segments.forEach(function (segment, index) {
      breakdown.appendChild(createSegment(segment, index, {
        type: Paragraph.UNIT_TYPES.PARAGRAPH,
        id: paragraph.id
      }));
    });

    const actions = document.createElement("div");
    actions.className = "message_actions paragraph_actions";

    const join = createJoinButton(Paragraph.UNIT_TYPES.PARAGRAPH, paragraph.id);

    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "message_action";
    edit.textContent = "Edit";
    edit.dataset.action = "edit-paragraph";
    edit.dataset.paragraphId = paragraph.id;

    const breakdownButton = document.createElement("button");
    breakdownButton.type = "button";
    breakdownButton.className = "message_action";
    breakdownButton.textContent = "Break down";
    breakdownButton.dataset.action = "breakdown";
    breakdownButton.dataset.paragraphId = paragraph.id;

    actions.append(join, edit, breakdownButton);
    bubble.append(summary, breakdown, actions);
    card.append(meta, bubble);
    row.appendChild(card);

    return row;
  }

  function renderConversation() {
    el.conversation.innerHTML = "";

    const Model = getModel();
    const Paragraph = getParagraphController();
    const units = Paragraph.getVisibleUnits(state.sentences, state.paragraphs);

    if (!units.length) {
      el.conversation.appendChild(createEmptyState());
      return;
    }

    units.forEach(function (unit) {
      if (unit.type === Model.UNIT_TYPES.PARAGRAPH) {
        el.conversation.appendChild(createParagraphCard(unit));
      } else {
        el.conversation.appendChild(createSentenceCard(unit));
      }
    });
  }

  function scrollToLatest() {
    requestAnimationFrame(function () {
      const rows = el.conversation.querySelectorAll(".message_row, .paragraph_row");
      const last = rows[rows.length - 1];

      if (last) {
        last.scrollIntoView({
          behavior: "smooth",
          block: "end"
        });
      }
    });
  }

  function resizeInput() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, 150) + "px";
  }

  function clearComposer() {
    el.input.value = "";
    resizeInput();
  }

  function endEditing() {
    state.editingId = null;
    el.cancelEditButton.hidden = true;
    el.aiButton.disabled = state.busy;
    updateSendButtonText();
    clearComposer();
  }

  function beginEditing(sentenceId) {
    if (state.busy) {
      return;
    }

    const Model = getModel();
    const sentence = state.sentences.find(function (item) {
      return item.id === sentenceId;
    });

    if (!sentence) {
      return;
    }

    clearJoinSelection();
    state.editingId = sentence.id;
    setSpeaker(sentence.speaker);

    el.input.value = sentence.originalInput ||
      Model.sentenceTargetText(sentence, state.direction);

    el.cancelEditButton.hidden = false;
    el.aiButton.disabled = true;
    updateSendButtonText();
    resizeInput();
    el.input.focus();
  }

  async function deleteSentence(sentenceId) {
    if (state.busy || !state.room) {
      return;
    }

    const sentence = state.sentences.find(function (item) {
      return item.id === sentenceId;
    });

    if (!sentence) return;

    const confirmed = global.confirm("Delete this sentence?");
    if (!confirmed) return;

    clearJoinSelection();
    const Firebase = await getFirebase();
    setBusy(true);
    setStatus("Deleting sentence…");

    try {
      await Firebase.deleteSentence(state.room.id, sentenceId);

      state.sentences = state.sentences.filter(function (item) {
        return item.id !== sentenceId;
      });

      if (state.editingId === sentenceId) {
        endEditing();
      }

      setStatus("");
      renderConversation();
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not delete the sentence.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function sendManualSentence() {
    if (state.busy || !state.room) {
      return;
    }

    const Model = getModel();
    const Sentence = getSentenceController();
    const Firebase = await getFirebase();
    const text = Model.cleanMultilineText(el.input.value);

    if (!text) {
      setStatus("Enter one sentence.", "error");
      el.input.focus();
      return;
    }

    const controller = createController();
    setBusy(true);
    el.sendButton.textContent = state.editingId ? "Updating…" : "Sending…";
    setStatus("Understanding your sentence…");

    try {
      let result;

      if (state.editingId) {
        const existing = state.sentences.find(function (item) {
          return item.id === state.editingId;
        });

        if (!existing) {
          throw new Error("The sentence being edited could not be found.");
        }

        result = await Sentence.updateManual(
          existing,
          {
            direction: state.direction,
            text
          },
          {
            signal: controller.signal,
            onStatus: function (message) {
              if (message) {
                setStatus(message);
              }
            }
          }
        );
      } else {
        result = await Sentence.processManual(
          {
            direction: state.direction,
            speaker: state.speaker,
            text,
            order: Sentence.getNextOrder(state.sentences)
          },
          {
            signal: controller.signal,
            onStatus: function (message) {
              if (message) {
                setStatus(message);
              }
            }
          }
        );
      }

      if (result.valid !== true) {
        setStatus(
          result.message || "Please enter one sentence at a time.",
          "error"
        );
        return;
      }

      setStatus("Saving sentence…");
      const saved = Model.createSentence(
        await Firebase.saveSentence(state.room.id, result.sentence)
      );

      if (state.editingId) {
        const editingId = state.editingId;

        state.sentences = state.sentences.map(function (item) {
          return item.id === editingId
            ? saved
            : item;
        });

        state.editingId = null;
        el.cancelEditButton.hidden = true;
      } else {
        state.sentences.push(saved);
      }

      clearComposer();
      setStatus("");
      renderConversation();
      scrollToLatest();
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error(error);
        setStatus(error?.message || "Could not process the sentence.", "error");
      }
    } finally {
      finishController(controller);
      setBusy(false);
    }
  }

  async function generateAIConversationTurn() {
    if (state.busy || state.editingId || !state.room) {
      return;
    }

    const Model = getModel();
    const Sentence = getSentenceController();
    const Firebase = await getFirebase();
    const controller = createController();

    setBusy(true);
    el.aiButton.textContent = "Thinking…";
    setStatus("AI is writing the next turn…");

    try {
      const sentence = await Sentence.generateNextAI(
        {
          direction: state.direction,
          sentences: state.sentences
        },
        {
          signal: controller.signal,
          onStatus: function (message) {
            if (message) {
              setStatus(message);
            }
          }
        }
      );

      setStatus("Saving AI sentence…");
      const saved = Model.createSentence(
        await Firebase.saveSentence(state.room.id, sentence)
      );

      state.sentences.push(saved);
      setStatus("");
      renderConversation();
      scrollToLatest();
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error(error);
        setStatus(error?.message || "Could not generate the next turn.", "error");
      }
    } finally {
      finishController(controller);
      el.aiButton.innerHTML = '<span aria-hidden="true">✦</span> AI next turn';
      setBusy(false);
    }
  }

  async function joinWithSelection(type, id) {
    if (state.busy || state.editingId || !state.room) {
      if (state.editingId) {
        setStatus("Finish or cancel the current edit before joining a paragraph.", "error");
      }
      return;
    }

    const Paragraph = getParagraphController();
    const current = { type, id };

    if (!state.joinSelection) {
      state.joinSelection = current;
      setStatus("Selected. Choose one more sentence or paragraph to join.");
      renderConversation();
      return;
    }

    if (
      state.joinSelection.type === current.type &&
      state.joinSelection.id === current.id
    ) {
      clearJoinSelection();
      setStatus("");
      renderConversation();
      return;
    }

    const first = state.joinSelection;
    const Firebase = await getFirebase();
    const controller = createController();

    setBusy(true);
    setStatus("Creating a fresh paragraph translation…");

    try {
      const result = await Paragraph.build(
        {
          direction: state.direction,
          units: [first, current],
          sentences: state.sentences,
          paragraphs: state.paragraphs
        },
        {
          signal: controller.signal,
          onStatus: function (message) {
            if (message) setStatus(message);
          }
        }
      );

      setStatus("Saving paragraph…");
      const saved = getModel().createParagraph(
        await Firebase.replaceParagraphGrouping(state.room.id, {
          paragraph: result.paragraph,
          deleteParagraphIds: result.replacedParagraphIds
        })
      );

      const childIds = new Set(saved.sentenceIds);
      const removedParagraphIds = new Set(result.replacedParagraphIds);

      state.sentences = state.sentences.map(function (sentence) {
        if (!childIds.has(sentence.id)) return sentence;

        return getModel().createSentence(Object.assign({}, sentence, {
          paragraphId: saved.id,
          updatedAt: new Date().toISOString()
        }));
      });

      state.paragraphs = state.paragraphs
        .filter(function (paragraph) {
          return !removedParagraphIds.has(paragraph.id);
        })
        .concat(saved);

      clearJoinSelection();
      setStatus("");
      renderConversation();
      scrollToLatest();
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error(error);
        setStatus(error?.message || "Could not create the paragraph.", "error");
      }
    } finally {
      finishController(controller);
      setBusy(false);
    }
  }

  async function breakdownParagraph(paragraphId, editAfter) {
    if (state.busy || !state.room) {
      return;
    }

    const Paragraph = getParagraphController();
    const Firebase = await getFirebase();
    const paragraph = Paragraph.getParagraphById(state.paragraphs, paragraphId);

    if (!paragraph) {
      return;
    }

    const children = Paragraph.getParagraphChildren(paragraph, state.sentences);

    let editTargetId = null;

    clearJoinSelection();
    setBusy(true);
    setStatus("Breaking paragraph back into its original sentences…");

    try {
      await Firebase.breakdownParagraphGrouping(state.room.id, paragraph);

      const childIds = new Set(paragraph.sentenceIds);
      state.sentences = state.sentences.map(function (sentence) {
        if (!childIds.has(sentence.id)) return sentence;

        return getModel().createSentence(Object.assign({}, sentence, {
          paragraphId: null,
          updatedAt: new Date().toISOString()
        }));
      });

      state.paragraphs = state.paragraphs.filter(function (item) {
        return item.id !== paragraph.id;
      });

      setStatus("");
      renderConversation();

      if (editAfter && children.length) {
        editTargetId = children[0].id;
      }
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not break down the paragraph.", "error");
    } finally {
      setBusy(false);
    }

    if (editTargetId) {
      beginEditing(editTargetId);
      setStatus(
        "Paragraph broken down. Edit the sentence you want, then use + to build the paragraph again."
      );
    }
  }

  function handleConversationClick(event) {
    const dictionaryWord = event.target.closest(
      "button[data-dictionary-breakdown=\"true\"]"
    );

    if (dictionaryWord) {
      openBreakdownDictionary(dictionaryWord);
      return;
    }

    const button = event.target.closest("button[data-action]");

    if (!button) {
      return;
    }

    const action = button.dataset.action;
    const sentenceId = button.dataset.sentenceId;
    const paragraphId = button.dataset.paragraphId;

    if (action === "join") {
      joinWithSelection(button.dataset.unitType, button.dataset.unitId);
      return;
    }

    if (action === "edit") {
      beginEditing(sentenceId);
      return;
    }

    if (action === "delete") {
      deleteSentence(sentenceId);
      return;
    }

    if (action === "breakdown") {
      breakdownParagraph(paragraphId, false);
      return;
    }

    if (action === "edit-paragraph") {
      breakdownParagraph(paragraphId, true);
    }
  }

  function bindEvents() {
    el.speakerUser.addEventListener("click", function () {
      setSpeaker("user");
    });

    el.speakerPartner.addEventListener("click", function () {
      setSpeaker("partner");
    });

    el.directionEnJa.addEventListener("click", function () {
      changeDirection("en-ja");
    });

    el.directionJaEn.addEventListener("click", function () {
      changeDirection("ja-en");
    });

    el.sendButton.addEventListener("click", sendManualSentence);
    el.aiButton.addEventListener("click", generateAIConversationTurn);

    el.cancelEditButton.addEventListener("click", function () {
      if (!state.busy) {
        endEditing();
        setStatus("");
      }
    });

    el.conversation.addEventListener("click", handleConversationClick);

    el.input.addEventListener("input", resizeInput);

    el.input.addEventListener("keydown", function (event) {
      if (
        event.key === "Enter" &&
        (event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault();
        sendManualSentence();
      }
    });
  }

  async function init() {
    cacheElements();
    getModel();
    getSentenceController();
    getParagraphController();

    bindEvents();
    setSpeaker(state.speaker);
    setDirection(state.direction);
    updateSendButtonText();
    resizeInput();
    setBusy(true);
    setStatus("Loading conversation…");

    try {
      const Firebase = await getFirebase();

      if (!Firebase.getCurrentUser()?.userId) {
        global.location.replace("loginregister.html");
        return;
      }

      const roomId = Firebase.getActiveRoomId();
      if (!roomId) {
        global.location.replace("welcome.html");
        return;
      }

      const data = await Firebase.loadRoomData(roomId);
      const Model = getModel();

      state.room = Model.createRoom(data.room);
      state.direction = state.room.direction;
      state.sentences = normalizeLoadedSentences(data.sentences);
      state.paragraphs = normalizeLoadedParagraphs(data.paragraphs);

      if (el.roomName) {
        el.roomName.textContent = state.room.name;
      }

      setDirection(state.direction);
      setStatus("");
      renderConversation();
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Could not load this conversation.", "error");
    } finally {
      setBusy(false);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  global.ConversateApp = Object.freeze({
    getState: function () {
      return {
        room: state.room ? Object.assign({}, state.room) : null,
        direction: state.direction,
        speaker: state.speaker,
        sentences: state.sentences.slice(),
        paragraphs: state.paragraphs.slice(),
        joinSelection: state.joinSelection
          ? Object.assign({}, state.joinSelection)
          : null,
        editingId: state.editingId,
        busy: state.busy
      };
    },
    render: renderConversation,
    replaceBreakdownSegment
  });
})(window);
