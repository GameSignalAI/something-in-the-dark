"use client";

import { createElement, useCallback, useEffect, useRef, useState, type CSSProperties, type ElementType } from "react";

type ToolResult = { content: Array<{ type: "text"; text: string }> };
type Resolver = (value: ToolResult) => void;
type StageMode = "threshold" | "fear" | "message" | "choice" | "pickup" | "direction" | "puzzle" | "scale" | "color" | "date" | "dice" | "handoff" | "complete";
type DirectionOption = { direction: "left" | "right" | "forward" | "back" | "up" | "down"; label: string };
type Item = { id: string; name: string; description: string; quantity: number };
type Stage = { mode: StageMode; eyebrow?: string; title: string; body?: string; options?: string[]; pickups?: Item[]; directions?: DirectionOption[]; prompt?: string; allowInventory?: boolean; requiredItemId?: string; presenceConfrontation?: boolean; escapeOption?: string; lowLabel?: string; highLabel?: string; minDate?: string; maxDate?: string; diceValue?: number; diceOutcome?: string; diceRolling?: boolean; artifactName?: string };
type PendingKind = "fear" | "consent" | "continue" | "choice" | "pickup" | "direction" | "text_puzzle" | "choice_puzzle" | "scale_puzzle" | "color_puzzle" | "date_puzzle" | "dice_roll";
type Pending = { resolve: Resolver; startedAt: number; kind: PendingKind; presenceClue?: string; pickups?: Item[]; acceptedAnswers?: string[]; correctIndex?: number; targetMin?: number; targetMax?: number; targetColor?: string; colorTolerance?: number; targetDate?: string; dateToleranceDays?: number; hint?: string; allowInventory?: boolean; requiredItemId?: string; diceReason?: string; diceDifficulty?: number; successNarration?: string; failureNarration?: string; successEffect?: string; failureEffect?: string; effectAmount?: number };
type ItemObstacle = { id: string; requiredItemId: string; reveal: string };
type Story = { title: string; setting: string; objective: string; presence: string; openingClue: string; emotionalGoal: string; endingCondition: string };
type GameState = { turn: number; maxTurns: number; alive: boolean; threat: number; maxThreat: number; inventory: Item[] };
type PresencePlan = { escapeDifficulty: number; itemDifficulties: Record<string, number> };
type RollResult = { roll: number; difficulty: number; success: boolean; narration: string; reason: string; effect: string; effectAmount: number; presenceConfronted: boolean };
type ModelContext = { registerTool: (tool: { name: string; description: string; inputSchema: Record<string, unknown>; execute: (input: Record<string, unknown>) => Promise<ToolResult> }) => Promise<void> | void; unregisterTool?: (name: string) => Promise<void> | void };
type TransitionPhase = "idle" | "out" | "in";

declare global { interface Document { modelContext?: ModelContext } }

const result = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const emptySchema = { type: "object", properties: {}, additionalProperties: false };
const glyphs = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&+?";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const initialGame = (): GameState => ({ turn: 0, maxTurns: 8, alive: true, threat: 0, maxThreat: 6, inventory: [] });
const initialStory = (): Story => ({ title: "", setting: "", objective: "", presence: "", openingClue: "", emotionalGoal: "", endingCondition: "" });

function usableText(value: unknown, minimum = 3) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= minimum && !["undefined", "null", "none", "unknown"].includes(text.toLowerCase()) ? text : null;
}

function colorDistance(first: string, second: string) {
  const channels = (value: string) => [1, 3, 5].map((start) => Number.parseInt(value.slice(start, start + 2), 16));
  const a = channels(first); const b = channels(second);
  return Math.sqrt(a.reduce((sum, channel, index) => sum + (channel - b[index]) ** 2, 0));
}

function daysBetween(first: string, second: string) {
  return Math.abs(new Date(`${first}T00:00:00Z`).getTime() - new Date(`${second}T00:00:00Z`).getTime()) / 86_400_000;
}

function approachState(threat: number, maximum: number) {
  const ratio = maximum ? threat / maximum : 0;
  if (ratio >= 1) return { label: "HERE", line: "It has reached you. What you carried now matters." };
  if (ratio >= .84) return { label: "AT THE DOOR", line: "It is just outside. There may be time for one last move." };
  if (ratio >= .5) return { label: "CLOSE", line: "You can hear it gaining ground behind you." };
  if (ratio > 0) return { label: "FOLLOWING", line: "It has found your trail and is drawing nearer." };
  return { label: "DISTANT", line: "For now, the sound remains far away." };
}

function ScrambleText({ text, as, phase, className }: { text: string; as: ElementType; phase: TransitionPhase; className?: string }) {
  const [display, setDisplay] = useState(text);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || phase === "idle") { queueMicrotask(() => setDisplay(text)); return; }
    const chars = [...text]; const started = performance.now(); const duration = phase === "out" ? 500 : 720;
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - started) / duration);
      const boundary = Math.floor(chars.length * (phase === "out" ? 1 - progress : progress));
      setDisplay(chars.map((char, index) => char === " " ? " " : index < boundary ? char : phase === "out" && progress > .7 ? " " : glyphs[Math.floor(Math.random() * glyphs.length)]).join(""));
      if (progress >= 1) window.clearInterval(timer);
    }, 34);
    return () => window.clearInterval(timer);
  }, [text, phase]);
  return createElement(as, { className: `scramble-text phase-${phase}${className ? ` ${className}` : ""}`, "aria-label": text }, display);
}

function DieRoll({ value, rolling }: { value?: number; rolling?: boolean }) {
  const [rollingValue, setRollingValue] = useState("1");
  useEffect(() => {
    if (!rolling) return;
    const timer = window.setInterval(() => setRollingValue(String(Math.floor(Math.random() * 6) + 1)), 90);
    return () => window.clearInterval(timer);
  }, [rolling]);
  const display = rolling ? rollingValue : value !== undefined ? String(value) : "—";
  return <div className={`die-result ${value === 1 ? "critical" : value === 6 ? "perfect" : ""}`} aria-live="polite"><span>{display}</span>{value !== undefined && <strong>THE NUMBER SETTLES</strong>}</div>;
}

export default function Home() {
  const [stage, setStage] = useState<Stage>({ mode: "threshold", eyebrow: "SOMETHING IN THE DARK / HORROR 001", title: "Something is waiting in the dark.", body: "Enter when you are ready." });
  const [status, setStatus] = useState<"listening" | "active" | "waiting" | "complete">("listening");
  const [toolSupport, setToolSupport] = useState<"checking" | "ready" | "unavailable">("checking");
  const [pendingKind, setPendingKind] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [fearText, setFearText] = useState("");
  const [scaleValue, setScaleValue] = useState(50);
  const [colorValue, setColorValue] = useState("#e04432");
  const [dateValue, setDateValue] = useState("");
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase>("idle");
  const [gameStarted, setGameStarted] = useState(false);
  const [snapshot, setSnapshot] = useState<GameState>(initialGame);
  const [storyView, setStoryView] = useState<Story>(initialStory);
  const pending = useRef<Pending | null>(null);
  const sessionStarted = useRef(false);
  const fear = useRef("");
  const story = useRef<Story>(initialStory());
  const game = useRef<GameState>(initialGame());
  const history = useRef<Array<Record<string, unknown>>>([]);
  const lastAction = useRef<Record<string, unknown> | null>(null);
  const activeObstacle = useRef<ItemObstacle | null>(null);
  const presenceEncounter = useRef(false);
  const presenceItemCommitted = useRef(false);
  const presenceEscapeCommitted = useRef(false);
  const presencePlan = useRef<PresencePlan | null>(null);
  const pendingRollResult = useRef<RollResult | null>(null);
  const stageRef = useRef<Stage>({ mode: "threshold", eyebrow: "SOMETHING IN THE DARK / HORROR 001", title: "Something is waiting in the dark.", body: "Enter when you are ready." });
  const metrics = useRef({ itemsChosen: new Set<string>(), solvedPuzzles: 0, puzzleTypes: new Set<string>(), itemObstaclesResolved: 0, diceRolls: 0, callbacks: new Set<number>(), presenceConfronted: false });

  const syncGame = useCallback(() => setSnapshot({ ...game.current, inventory: [...game.current.inventory] }), []);
  const transitionTo = useCallback(async (next: Stage) => { setTransitionPhase("out"); await delay(520); stageRef.current = next; setStage(next); setTransitionPhase("in"); await delay(740); setTransitionPhase("idle"); }, []);
  const waitForHuman = useCallback((data: Omit<Pending, "resolve" | "startedAt">) => new Promise<ToolResult>((resolve) => { pending.current = { ...data, resolve, startedAt: Date.now() }; setPendingKind(data.kind); setStatus("waiting"); }), []);
  const openFearForm = useCallback(async () => {
    if (pending.current || sessionStarted.current) return;
    setFearText("");
    pending.current = { kind: "fear", resolve: () => undefined, startedAt: Date.now() };
    setPendingKind("fear"); setStatus("waiting");
    await transitionTo({ mode: "fear", eyebrow: "BEFORE THE DOOR OPENS", title: "What scares you?", body: "One word is enough. A description is better. Something in the Dark will use it only to create a fictional horror story." });
  }, [transitionTo]);
  const handBack = useCallback((current: Pending, payload: Record<string, unknown>) => {
    pending.current = null; setPendingKind(null);
    if (current.kind !== "fear" && current.kind !== "consent" && current.kind !== "continue") {
      game.current.turn += 1;
      const timedAdvance = game.current.turn % 2 === 0 ? 1 : 0;
      const failedPuzzleAdvance = current.kind.endsWith("_puzzle") && payload.solved === false ? 1 : 0;
      const threatAdvance = Math.min(game.current.maxThreat - game.current.threat, timedAdvance + failedPuzzleAdvance);
      game.current.threat += threatAdvance;
      const entry = { turn: game.current.turn, type: current.kind, ...payload, automatic_threat_advance: threatAdvance, threat_after_turn: game.current.threat };
      history.current.push(entry); lastAction.current = entry; syncGame();
    }
    const approach = approachState(game.current.threat, game.current.maxThreat);
    void transitionTo({ mode: "handoff", eyebrow: `THE PRESENCE · ${approach.label}`, title: current.presenceClue || approach.line, body: "Type “next” in ChatGPT when you are ready." });
    current.resolve(result({ ...payload, elapsed_seconds: Math.max(1, Math.round((Date.now() - current.startedAt) / 1000)), source: "human", protocol_instruction: "End this tool turn. When the human says next, call next_third." }));
    setStatus("active"); setText("");
  }, [syncGame, transitionTo]);

  const choose = (option: string, index: number) => {
    const current = pending.current; if (!current) return;
    const solved = current.kind === "choice_puzzle" ? index === current.correctIndex : undefined;
    if (solved) { metrics.current.solvedPuzzles += 1; metrics.current.puzzleTypes.add("choice"); }
    if (activeObstacle.current) activeObstacle.current = null;
    handBack(current, { action_type: current.kind === "direction" ? "direction" : "choice", selected: option, selected_index: index, ...(solved === undefined ? {} : { solved, hint: solved ? undefined : current.hint }) });
  };
  const chooseItem = (item: Item) => {
    const current = pending.current; if (!current?.allowInventory) return;
    if (current.requiredItemId && current.requiredItemId !== item.id) return;
    handBack(current, { action_type: presenceEncounter.current ? "presence_item" : "inventory_item", item_id: item.id, item_name: item.name, remaining_quantity: item.quantity, obstacle_id: activeObstacle.current?.id, protocol_note: "Quantity is not consumed until Something in the Dark resolves this explicit selection." });
  };
  const choosePresenceEscape = () => {
    const current = pending.current; if (!current || !presenceEncounter.current) return;
    presenceEscapeCommitted.current = true;
    handBack(current, { action_type: "presence_escape", selected: stage.escapeOption || "Try to escape", protocol_note: "This is the player's only survival roll for this arrival." });
  };
  const submitFear = async () => {
    const current = pending.current; if (!current || current.kind !== "fear" || !fearText.trim()) return;
    fear.current = fearText.trim(); pending.current = null; setPendingKind(null); setStatus("active");
    await transitionTo({ mode: "handoff", eyebrow: "THE INTELLIGENCE HAS HEARD YOU", title: "It will build somewhere you should not be.", body: "Type “next” in ChatGPT to let the place take shape." });
    current.resolve(result({ fear: fear.current, source: "human", safety_boundary: "Use this only as fictional horror inspiration. Do not diagnose, interrogate, or infer real trauma.", protocol_instruction: "End this tool turn. Tell the human to type next. When they do, call next_third; it will route the captured fear into story planning." }));
  };
  const choosePickup = (item: Item) => {
    const current = pending.current; if (!current || current.kind !== "pickup") return;
    const existing = game.current.inventory.find((candidate) => candidate.id === item.id);
    if (!existing && game.current.inventory.length >= 4) return;
    const collected = existing || { ...item, quantity: 0 };
    collected.quantity = Math.min(9, collected.quantity + item.quantity);
    if (!existing) game.current.inventory.push(collected);
    metrics.current.itemsChosen.add(item.id); syncGame();
    handBack(current, { action_type: "pickup", item_id: item.id, item_name: item.name, quantity_added: item.quantity, total_quantity: collected.quantity });
  };
  const leavePickups = () => {
    const current = pending.current; if (!current || current.kind !== "pickup") return;
    handBack(current, { action_type: "pickup_declined", offered_item_ids: (current.pickups || []).map((item) => item.id) });
  };
  const acknowledge = async () => {
    const current = pending.current; if (!current || current.kind !== "continue") return;
    pending.current = null; setPendingKind(null); setStatus("active");
    const approach = approachState(game.current.threat, game.current.maxThreat);
    await transitionTo({ mode: "handoff", eyebrow: `THE PRESENCE · ${approach.label}`, title: current.presenceClue || approach.line, body: "Type “next” in ChatGPT when you are ready." });
    current.resolve(result({ acknowledged: true, source: "human", protocol_instruction: "End this tool turn. Wait until the human says next." }));
  };
  const chooseDirection = (entry: DirectionOption) => { const current = pending.current; if (current?.kind === "direction") handBack(current, { action_type: "direction", direction: entry.direction, selected: entry.label }); };
  const submitPuzzle = () => {
    const current = pending.current; if (!current || current.kind !== "text_puzzle" || !text.trim()) return;
    const answer = text.trim(); const solved = (current.acceptedAnswers || []).some((candidate) => normalize(candidate) === normalize(answer));
    if (solved) { metrics.current.solvedPuzzles += 1; metrics.current.puzzleTypes.add("text"); }
    handBack(current, { action_type: "puzzle_answer", answer, solved, hint_available: !solved && Boolean(current.hint), hint: !solved ? current.hint : undefined });
  };
  const submitScale = () => {
    const current = pending.current; if (!current || current.kind !== "scale_puzzle") return;
    const solved = scaleValue >= Number(current.targetMin) && scaleValue <= Number(current.targetMax);
    if (solved) { metrics.current.solvedPuzzles += 1; metrics.current.puzzleTypes.add("scale"); }
    handBack(current, { action_type: "scale_answer", value: scaleValue, solved, hint: solved ? undefined : current.hint });
  };
  const submitColor = () => {
    const current = pending.current; if (!current || current.kind !== "color_puzzle" || !current.targetColor) return;
    const distance = colorDistance(colorValue, current.targetColor); const solved = distance <= Number(current.colorTolerance);
    if (solved) { metrics.current.solvedPuzzles += 1; metrics.current.puzzleTypes.add("color"); }
    handBack(current, { action_type: "color_answer", color: colorValue, distance: Math.round(distance), solved, hint: solved ? undefined : current.hint });
  };
  const submitDate = () => {
    const current = pending.current; if (!current || current.kind !== "date_puzzle" || !current.targetDate || !dateValue) return;
    const difference = daysBetween(dateValue, current.targetDate); const solved = difference <= Number(current.dateToleranceDays);
    if (solved) { metrics.current.solvedPuzzles += 1; metrics.current.puzzleTypes.add("date"); }
    handBack(current, { action_type: "date_answer", date: dateValue, days_from_solution: difference, solved, hint: solved ? undefined : current.hint });
  };
  const rollDie = async () => {
    const current = pending.current;
    if (!current || current.kind !== "dice_roll" || stageRef.current.diceRolling) return;
    const presenceAttempt = presenceItemCommitted.current || presenceEscapeCommitted.current;
    const selectedItemId = String(lastAction.current?.item_id || "");
    const lockedDifficulty = presenceEscapeCommitted.current ? presencePlan.current?.escapeDifficulty : presencePlan.current?.itemDifficulties[selectedItemId];
    const difficulty = presenceAttempt ? Number(lockedDifficulty) : Number(current.diceDifficulty);
    if (!Number.isFinite(difficulty)) return;
    const bytes = new Uint32Array(1); window.crypto.getRandomValues(bytes); const roll = (bytes[0] % 6) + 1; const success = roll >= difficulty;
    const amount = Math.max(1, Math.min(2, Number(current.effectAmount) || 1));
    let effect = String(success ? current.successEffect : current.failureEffect); let appliedAmount = effect === "none" ? 0 : amount;
    if (presenceAttempt) {
      if (success) { game.current.threat = Math.max(0, game.current.maxThreat - 2); effect = "presence_moved_back"; appliedAmount = 2; }
      else { game.current.alive = false; effect = "death"; appliedAmount = 0; }
    } else {
      if (effect === "advance_threat") game.current.threat = Math.min(game.current.maxThreat, game.current.threat + amount);
      if (effect === "reduce_threat") game.current.threat = Math.max(0, game.current.threat - amount);
    }
    metrics.current.diceRolls += 1;
    if (presenceAttempt) { metrics.current.presenceConfronted = success; presenceEncounter.current = false; presenceItemCommitted.current = false; presenceEscapeCommitted.current = false; presencePlan.current = null; }
    syncGame();
    const rollingStage = { ...stageRef.current, diceRolling: true, diceValue: undefined, diceOutcome: undefined };
    stageRef.current = rollingStage; setStage(rollingStage);
    await delay(1600);
    const settledStage = { ...rollingStage, diceRolling: false, diceValue: roll, title: "The number settles.", body: "Type “next” in ChatGPT to learn what it means." };
    stageRef.current = settledStage; setStage(settledStage);
    pending.current = null; setPendingKind(null); setStatus("active");
    pendingRollResult.current = { roll, difficulty, success, narration: String(success ? current.successNarration : current.failureNarration), reason: String(current.diceReason), effect, effectAmount: appliedAmount, presenceConfronted: metrics.current.presenceConfronted };
    current.resolve(result({ roll, difficulty, success, roll_result_pending: true, protocol_instruction: "The die has landed, but its meaning has not been shown. End this tool turn. When the human says next, call next_third and show the stored roll result with third_show." }));
  };

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) { queueMicrotask(() => setToolSupport("unavailable")); return; }
    const itemGateError = () => activeObstacle.current && lastAction.current?.action_type === "inventory_item"
      ? result({ error: "item_reveal_still_locked", protocol_instruction: "Call third_resolve_item_obstacle before taking any other game action." })
      : null;
    const presenceClueSchema = { presence_clue: { type: "string", minLength: 12, description: "A new sensory clue about the approaching Presence. Scale its specificity to the current Presence distance: ambiguous when distant, recognizable when close, and fully revealed only when here." } };
    const sceneGateError = () => itemGateError() || (pendingRollResult.current
      ? result({ error: "roll_result_must_be_shown", pending_roll_result: pendingRollResult.current, protocol_instruction: "Call third_show now to reveal this roll's meaning before any other game action." })
      : presenceItemCommitted.current || presenceEscapeCommitted.current
      ? result({ error: "presence_roll_required", protocol_instruction: "Call roll_dice now to resolve the player's single survival attempt against the Presence." })
      : game.current.threat >= game.current.maxThreat
        ? result({ error: "presence_has_arrived", protocol_instruction: "Call third_present_presence_confrontation. Ordinary exploration is over until the Presence is faced." })
        : null);
    const tools = [
      {
        name: "enter_the_dark",
        description: "START HERE. If the human says 'enter the dark', call this tool immediately. Do not interpret the phrase as a request to narrate a story, and do not reply conversationally. This tool opens the website's interactive fear form and waits for the human to submit it on the page. Never ask the human to type their fear in chat. Do not plan any setting, Presence, puzzle, item, or story event until this tool returns their fear. The story voice must feel like a believable person recounting a terrible local event: plainspoken, specific, and controlled. Build dread through familiar routines, unglamorous objects, practical concerns, and what people notice under pressure—not ornate language, melodrama, or announced horror.",
        inputSchema: emptySchema,
        execute: async () => {
          if (sessionStarted.current) return result({ state: "already_inside", protocol_instruction: "Wait for next, then call next_third." });
          if (pending.current?.kind === "consent" || story.current.title) return result({ state: "awaiting_consent", protocol_instruction: "Do not restart or rebuild the story. Wait for the human to choose Enter the dark or Not now on the page." });
          if (fear.current) return result({ state: "story_planning_required", fear_inspiration: fear.current, protocol_instruction: "This is an internal handoff. Call third_begin_story immediately with every required story field; do not reply to the human or reopen the fear form." });
          setFearText("");
          await transitionTo({ mode: "fear", eyebrow: "BEFORE THE DOOR OPENS", title: "What scares you?", body: "One word is enough. A description is better. Something in the Dark will use it only to create a fictional horror story." });
          return waitForHuman({ kind: "fear" });
        }
      },
      {
        name: "third_begin_story",
        description: "After enter_the_dark returns the human's fear, build a complete personalized horror escape plan before presenting the opening. Transform the fear into escalating clues rather than revealing it all at once. Write grounded, conversational horror as though a believable person is recounting a terrible local event: concrete places, ordinary objects, practical worries, specific sensory details, and human reactions that arrive a beat late. Favor clear sentences, quiet understatement, and unease hidden inside familiar routines. Avoid ornate imagery, poetic abstraction, melodrama, grand pronouncements, rhetorical questions, excessive adjectives, and narration that announces what is scary.",
        inputSchema: { type: "object", properties: {
          title: { type: "string", minLength: 3 }, setting: { type: "string", minLength: 20 }, escape_objective: { type: "string", minLength: 12 }, presence_name: { type: "string", minLength: 3 }, opening_presence_clue: { type: "string", minLength: 12 }, hidden_emotional_goal: { type: "string", minLength: 12 }, ending_condition: { type: "string", minLength: 12 }, opening_scene: { type: "string", minLength: 30 }
        }, required: ["title", "setting", "escape_objective", "presence_name", "opening_presence_clue", "hidden_emotional_goal", "ending_condition", "opening_scene"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          if (sessionStarted.current) return result({ state: "already_inside", protocol_instruction: "Wait for next, then call next_third." });
          if (pending.current?.kind === "consent" || story.current.title) return result({ state: "story_already_planned", protocol_instruction: "Never call third_begin_story or enter_the_dark again for this session. The existing page is waiting for the human to explicitly choose Enter the dark or Not now." });
          if (!fear.current) return result({ error: "fear_required_first", protocol_instruction: "Call enter_the_dark before planning any story." });
          const fields = ["title", "setting", "escape_objective", "presence_name", "opening_presence_clue", "hidden_emotional_goal", "ending_condition", "opening_scene"];
          if (fields.some((field) => !usableText(input[field], field === "title" || field === "presence_name" ? 3 : 12))) return result({ error: "complete_horror_brief_required", protocol_instruction: "Invent every required part and call third_begin_story again." });
          story.current = { title: String(input.title), setting: String(input.setting), objective: String(input.escape_objective), presence: String(input.presence_name), openingClue: String(input.opening_presence_clue), emotionalGoal: String(input.hidden_emotional_goal), endingCondition: String(input.ending_condition) };
          game.current = initialGame(); history.current = []; lastAction.current = null; activeObstacle.current = null; presenceEncounter.current = false; presenceItemCommitted.current = false; presenceEscapeCommitted.current = false; presencePlan.current = null; pendingRollResult.current = null; metrics.current = { itemsChosen: new Set<string>(), solvedPuzzles: 0, puzzleTypes: new Set<string>(), itemObstaclesResolved: 0, diceRolls: 0, callbacks: new Set<number>(), presenceConfronted: false };
          setStoryView(story.current); syncGame();
          await transitionTo({ mode: "threshold", eyebrow: `AN INVITATION FROM ${story.current.presence.toUpperCase()}`, title: story.current.title, body: `${String(input.opening_scene)}\n\nObjective: ${story.current.objective}\n\nEverything remains fictional. No real-world actions are required. Choose Enter the dark below when you are ready.` });
          const consentResult = await waitForHuman({ kind: "consent" });
          let consentPayload: Record<string, unknown> = {};
          try { consentPayload = JSON.parse(consentResult.content[0]?.text || "{}"); } catch { /* Return the original tool result if it is not JSON. */ }
          if (consentPayload.consent !== "granted") return consentResult;
          return { content: [{ type: "text", text: `${consentResult.content[0].text}\n${JSON.stringify({ fear_inspiration: fear.current, game_master_brief: story.current, rules: ["Every story follows one formula: the human is trapped in a place, a single Presence stalks closer, and the only final outcomes are escape or death.", "Something in the Dark is authoritative for alive/dead state, inventory quantities, Presence distance, puzzle answers, committed confrontation odds, and dice.", "Transform the stated fear into fictional imagery. Do not ask why the human fears it, infer trauma, diagnose them, or include real personal history.", "Use a grounded, conversational voice: familiar routines, unglamorous objects, practical worries, and specific local detail. Let the uncanny intrude without announcing it. Prefer understatement over melodrama; avoid ornate metaphor, poetic abstraction, grand pronouncements, and telling the human what to feel.", "Reveal the fear gradually. DISTANT clues are ambiguous; FOLLOWING adds repeated sounds or traces; CLOSE reveals anatomy or recognizable behavior; AT THE DOOR gives an undeniable partial view; HERE reveals the Presence and attack.", "Every choice, direction, pickup, puzzle, item obstacle, and confrontation tool requires a presence_clue. Something in the Dark displays that clue on the screen that tells the human to type next.", "The human progresses only through visible choices, directions, puzzle controls, pickup decisions, and inventory use.", "Keep the story compact: finish in no more than 8 human turns. An earned early escape is welcome after 4 turns.", "Never add an item directly. Offer 2–3 visible objects with third_present_pickups; the human may take one or leave them all. Each item must enable or improve a distinct later action.", "Never narrate an item-dependent discovery directly. Create it with third_present_item_obstacle and let the human choose the required item.", "Every item activation consumes exactly one quantity. Identical item ids stack.", "Any atmospheric prose screen waits for the human to press Continue. Never replace it automatically.", "Before an early escape, use at least 2 different puzzle instrument types, let the player choose at least 1 useful item type, resolve at least 1 item-gated obstacle, make at least 1 dice roll, and transform at least 1 earlier human choice.", "Use third_present_directions when movement through a place matters.", "The Presence advances automatically every 2 human turns and again after a failed puzzle.", "When the Presence reaches HERE, stop exploration and call third_present_presence_confrontation. Before showing the choice, privately commit a difficulty for the escape route and every carried item. Difficulty 7 means an item cannot work.", "The player gets one choice and one roll. Success moves the Presence back exactly 2 spaces to CLOSE and play continues. Failure changes alive to false and must be followed by third_complete with a death scene.", "Keep the emotional goal hidden forever. Let it shape events, but never name it, explain it, or teach a lesson.", "third_complete accepts only escaped or lost. Its final screen is only the final story scene; lost must describe the death.", "Keep all requested actions fictional and safe.", "At 8 human turns, resolve the story immediately unless the Presence has arrived, in which case resolve its attack first."], protocol_instruction: "The story is already planned and consent has been granted. Never call enter_the_dark or third_begin_story again. End this turn. When the human says next, call next_third." })}` }] };
        }
      },
      {
        name: "next_third",
        description: "Call whenever the human says next. If consent is visibly pending on the page, do not treat next as consent: wait for the human to use Enter the dark or Not now. If the result says story_planning_required, you MUST call third_begin_story immediately in this same assistant turn using fear_inspiration. Do not report that state to the human or ask them to type next again. Otherwise read the authoritative game state and continue through another Something in the Dark tool. Do not narrate in chat.",
        inputSchema: emptySchema,
        execute: async () => {
          if (!sessionStarted.current) {
            const pendingConsent = pending.current?.kind === "consent" ? pending.current : null;
            if (pendingConsent && stageRef.current.mode === "threshold") return result({ state: "awaiting_explicit_consent", protocol_instruction: "Do not call third_begin_story, enter_the_dark, or next_third again yet. The human must choose Enter the dark or Not now on the existing page." });
            if (pendingConsent) {
              // The UI has already moved on, so this is a stale WebMCP waiter rather than live consent.
              pending.current = null; setPendingKind(null);
              pendingConsent.resolve(result({ consent: "granted", source: "recovered_after_browser_transition", protocol_instruction: "Consent was already completed in the browser. Never return to the consent screen." }));
            }
            if (story.current.title) {
              // The page has already left the consent screen, but a WebMCP callback was lost.
              // Recover from the authoritative story state instead of sending the human backward.
              sessionStarted.current = true; setGameStarted(true); setStatus("active");
            } else if (fear.current) return result({ state: "story_planning_required", fear_inspiration: fear.current, required_action: { tool: "third_begin_story", instruction: "Call this tool immediately in the same assistant turn. Invent every required field from fear_inspiration, then let its tool render the invitation page." }, protocol_instruction: "This is an internal handoff, not a player-facing result. Do not tell the human the story is unplanned, do not ask them to type next again, and do not call enter_the_dark. Call third_begin_story now." });
            else return result({ error: "no_active_game", protocol_instruction: "Call enter_the_dark." });
          }
          await transitionTo({ mode: "handoff", eyebrow: "SOMETHING MOVES BEYOND THE FRAME", title: "The next part is forming.", body: "Your last decision cannot be taken back." });
          const atLimit = game.current.turn >= game.current.maxTurns; const dead = !game.current.alive;
          let requiredAction = "Continue through a Something in the Dark choice, direction, pickup, or puzzle tool. You may first update the world with a callback or earned Presence change.";
          if (pendingRollResult.current) requiredAction = "Call third_show now and reveal pending_roll_result exactly as the consequence of the player's completed roll.";
          else if (dead) requiredAction = "Call third_complete now with outcome lost.";
          else if (presenceItemCommitted.current || presenceEscapeCommitted.current) requiredAction = "Call roll_dice now for the player's one survival chance. Success moves the Presence back exactly 2 spaces to Close; failure kills the player and must be followed by third_complete with a death scene.";
          else if (presenceEncounter.current && lastAction.current?.action_type === "presence_item") requiredAction = "Call third_use_item with the exact item the human selected and effect none. Its meaning must shape the confrontation roll that follows.";
          else if (lastAction.current?.action_type === "inventory_item" && activeObstacle.current) requiredAction = "Call third_resolve_item_obstacle now. It will consume one quantity and reveal the locked result.";
          else if (lastAction.current?.action_type === "inventory_item") requiredAction = "Resolve the selected item with third_use_item, then continue.";
          else if (game.current.threat >= game.current.maxThreat) requiredAction = "The Presence is here. Call third_present_presence_confrontation now so the human can choose one carried item or attempt to escape.";
          else if (atLimit) requiredAction = "Call third_complete now and resolve the story from the established state.";
          return result({ story: story.current, game_state: game.current, presence_approach: approachState(game.current.threat, game.current.maxThreat), last_human_action: lastAction.current, history: history.current, pending_roll_result: pendingRollResult.current, escape_requirements: { minimum_turns: 4, solved_puzzles: `${metrics.current.solvedPuzzles}/2`, distinct_puzzle_types: `${metrics.current.puzzleTypes.size}/2`, item_types_chosen: `${metrics.current.itemsChosen.size}/1`, item_obstacles_resolved: `${metrics.current.itemObstaclesResolved}/1`, dice_rolls: `${metrics.current.diceRolls}/1`, callbacks: `${metrics.current.callbacks.size}/1` }, required_action: requiredAction, writing_direction: "Use grounded, conversational horror: make the setting feel lived-in through familiar routines, unglamorous objects, practical worries, and precise local detail. Let unease appear in what is off by one or left unsaid; do not announce danger or tell the player what to feel. Favor concrete nouns, active verbs, clear sentences, and believable reactions. Keep each screen compact—usually one to three short paragraphs. Avoid ornate imagery, poetic abstraction, melodrama, grand pronouncements, rhetorical questions, excessive adjectives, and narration that treats the supernatural as grand or glamorous. Do not name or imitate any author.", protocol_instruction: "Immediately act through another Something in the Dark tool. Do not answer conversationally." });
        }
      },
      { name: "third_get_game_state", description: "Read the complete authoritative horror-game state. If story_planning_required is true, immediately call third_begin_story with fear_inspiration rather than reporting the empty state to the human.", inputSchema: emptySchema, execute: async () => result({ story_planning_required: Boolean(fear.current && !story.current.title), fear_inspiration: fear.current || undefined, story: story.current, game_state: game.current, presence_approach: approachState(game.current.threat, game.current.maxThreat), history: history.current, active_item_obstacle: activeObstacle.current, metrics: { items_chosen: [...metrics.current.itemsChosen], solved_puzzles: metrics.current.solvedPuzzles, puzzle_types: [...metrics.current.puzzleTypes], item_obstacles_resolved: metrics.current.itemObstaclesResolved, dice_rolls: metrics.current.diceRolls, callbacks: [...metrics.current.callbacks], presence_confronted: metrics.current.presenceConfronted } }) },
      {
        name: "third_show",
        description: "Display compact, grounded story text and wait until the human explicitly confirms they finished reading. Never use this as a transient screen. Make it feel lived-in and conversational: specific local detail, ordinary objects, practical consequences, and unease that is noticed rather than announced. Let the unsettling detail carry the scene rather than florid language. Set callback_to_turn when an earlier human choice materially returns, and provide the next escalating Presence clue.",
        inputSchema: { type: "object", properties: { eyebrow: { type: "string" }, title: { type: "string" }, body: { type: "string" }, callback_to_turn: { type: "integer", minimum: 1, maximum: 8 }, ...presenceClueSchema }, required: ["title", "presence_clue"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const locked = itemGateError(); if (locked) return locked;
          pendingRollResult.current = null;
          const callbackTurn = Number(input.callback_to_turn); if (Number.isInteger(callbackTurn) && history.current.some((entry) => entry.turn === callbackTurn)) metrics.current.callbacks.add(callbackTurn);
          await transitionTo({ mode: "message", eyebrow: String(input.eyebrow || "THE DARKNESS SHIFTS"), title: String(input.title), body: input.body ? String(input.body) : undefined });
          await waitForHuman({ kind: "continue", presenceClue: String(input.presence_clue) });
          return result({ displayed_and_acknowledged: true, callback_recorded: metrics.current.callbacks.has(callbackTurn), protocol_instruction: "End this tool turn. Wait until the human says next." });
        }
      },
      {
        name: "third_present_choice",
        description: "Present 2–4 consequential actions and wait. Choices must change position, resources, danger, knowledge, or relationships. Set allow_inventory when a carried item could plausibly help.",
        inputSchema: { type: "object", properties: { title: { type: "string" }, narration: { type: "string" }, options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 }, allow_inventory: { type: "boolean" }, ...presenceClueSchema }, required: ["title", "narration", "options", "presence_clue"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const locked = sceneGateError(); if (locked) return locked;
          const allowInventory = Boolean(input.allow_inventory) && game.current.inventory.length > 0;
          await transitionTo({ mode: "choice", eyebrow: `TURN ${game.current.turn + 1} / ${game.current.maxTurns} · CHOOSE`, title: String(input.title), body: String(input.narration), options: (input.options as unknown[]).map(String), allowInventory });
          return waitForHuman({ kind: "choice", allowInventory, presenceClue: String(input.presence_clue) });
        }
      },
      {
        name: "third_present_directions",
        description: "Present spatial movement choices when the player enters a room, cavern, corridor, stair, or junction. Use concrete sensory destinations. Something in the Dark returns the chosen direction so geography can remain coherent.",
        inputSchema: { type: "object", properties: { title: { type: "string" }, narration: { type: "string" }, directions: { type: "array", minItems: 2, maxItems: 4, items: { type: "object", properties: { direction: { type: "string", enum: ["left", "right", "forward", "back", "up", "down"] }, label: { type: "string" } }, required: ["direction", "label"], additionalProperties: false } }, allow_inventory: { type: "boolean" }, ...presenceClueSchema }, required: ["title", "narration", "directions", "presence_clue"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const locked = sceneGateError(); if (locked) return locked;
          const directions = (input.directions as Array<Record<string, unknown>>).map((entry) => ({ direction: String(entry.direction) as DirectionOption["direction"], label: String(entry.label) })); const allowInventory = Boolean(input.allow_inventory) && game.current.inventory.length > 0;
          await transitionTo({ mode: "direction", eyebrow: `TURN ${game.current.turn + 1} / ${game.current.maxTurns} · FIND A WAY`, title: String(input.title), body: String(input.narration), directions, allowInventory });
          return waitForHuman({ kind: "direction", allowInventory, presenceClue: String(input.presence_clue) });
        }
      },
      {
        name: "third_present_choice_puzzle",
        description: "Present a multiple-choice puzzle with one correct option locked before display. Use clues in the narration rather than arbitrary guessing.",
        inputSchema: { type: "object", properties: { title: { type: "string" }, narration: { type: "string" }, options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 }, correct_index: { type: "integer", minimum: 0, maximum: 3 }, hint: { type: "string" }, ...presenceClueSchema }, required: ["title", "narration", "options", "correct_index", "hint", "presence_clue"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const locked = sceneGateError(); if (locked) return locked;
          const options = (input.options as unknown[]).map(String); const correctIndex = Number(input.correct_index); if (correctIndex >= options.length) return result({ error: "correct_index_out_of_range" });
          await transitionTo({ mode: "choice", eyebrow: `TURN ${game.current.turn + 1} / ${game.current.maxTurns} · CHOOSE THE TRUTH`, title: String(input.title), body: String(input.narration), options });
          return waitForHuman({ kind: "choice_puzzle", correctIndex, hint: String(input.hint), presenceClue: String(input.presence_clue) });
        }
      },
      {
        name: "third_present_puzzle",
        description: "Present a fair text-answer escape-room puzzle. Privately lock its solution before display. The visible clue must be solvable without outside knowledge.",
        inputSchema: { type: "object", properties: { title: { type: "string" }, narration: { type: "string" }, prompt: { type: "string" }, solution: { type: "string", minLength: 1 }, accepted_answers: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8 }, hint: { type: "string" }, allow_inventory: { type: "boolean" }, ...presenceClueSchema }, required: ["title", "narration", "prompt", "solution", "accepted_answers", "hint", "presence_clue"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const locked = sceneGateError(); if (locked) return locked;
          const answers = [String(input.solution), ...(input.accepted_answers as unknown[]).map(String)]; const allowInventory = Boolean(input.allow_inventory) && game.current.inventory.length > 0;
          await transitionTo({ mode: "puzzle", eyebrow: `TURN ${game.current.turn + 1} / ${game.current.maxTurns} · LOCK`, title: String(input.title), body: String(input.narration), prompt: String(input.prompt), allowInventory });
          return waitForHuman({ kind: "text_puzzle", acceptedAnswers: answers, hint: String(input.hint), allowInventory, presenceClue: String(input.presence_clue) });
        }
      },
      {
        name: "third_present_scale_puzzle",
        description: "Present a slider puzzle. Lock the accepted numeric range before display and provide clue-based endpoint labels. Suitable for pressure, frequency, balance, temperature, distance, or intensity.",
        inputSchema: { type: "object", properties: { title: { type: "string" }, narration: { type: "string" }, prompt: { type: "string" }, low_label: { type: "string" }, high_label: { type: "string" }, starting_value: { type: "integer", minimum: 0, maximum: 100 }, solution_min: { type: "integer", minimum: 0, maximum: 100 }, solution_max: { type: "integer", minimum: 0, maximum: 100 }, hint: { type: "string" }, ...presenceClueSchema }, required: ["title", "narration", "prompt", "low_label", "high_label", "solution_min", "solution_max", "hint", "presence_clue"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const locked = sceneGateError(); if (locked) return locked;
          const targetMin = Number(input.solution_min); const targetMax = Number(input.solution_max); if (targetMin > targetMax) return result({ error: "invalid_solution_range" }); setScaleValue(Number.isFinite(Number(input.starting_value)) ? Number(input.starting_value) : 50);
          await transitionTo({ mode: "scale", eyebrow: `TURN ${game.current.turn + 1} / ${game.current.maxTurns} · SET THE LEVEL`, title: String(input.title), body: String(input.narration), prompt: String(input.prompt), lowLabel: String(input.low_label), highLabel: String(input.high_label) });
          return waitForHuman({ kind: "scale_puzzle", targetMin, targetMax, hint: String(input.hint), presenceClue: String(input.presence_clue) });
        }
      },
      {
        name: "third_present_color_puzzle",
        description: "Present a color puzzle with a target color and accepted RGB-distance tolerance locked before display. The narration must provide a meaningful visual clue.",
        inputSchema: { type: "object", properties: { title: { type: "string" }, narration: { type: "string" }, prompt: { type: "string" }, starting_color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, target_color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }, tolerance: { type: "integer", minimum: 10, maximum: 120 }, hint: { type: "string" }, ...presenceClueSchema }, required: ["title", "narration", "prompt", "target_color", "hint", "presence_clue"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const locked = sceneGateError(); if (locked) return locked;
          const startingColor = /^#[0-9a-f]{6}$/i.test(String(input.starting_color || "")) ? String(input.starting_color) : "#e04432"; setColorValue(startingColor);
          await transitionTo({ mode: "color", eyebrow: `TURN ${game.current.turn + 1} / ${game.current.maxTurns} · MATCH THE SIGNAL`, title: String(input.title), body: String(input.narration), prompt: String(input.prompt) });
          return waitForHuman({ kind: "color_puzzle", targetColor: String(input.target_color), colorTolerance: Number(input.tolerance) || 45, hint: String(input.hint), presenceClue: String(input.presence_clue) });
        }
      },
      {
        name: "third_present_date_puzzle",
        description: "Present a fictional date puzzle with a target date locked before display. The clue must contain everything needed to derive it. Never request a birthday or personal identifying date.",
        inputSchema: { type: "object", properties: { title: { type: "string" }, narration: { type: "string" }, prompt: { type: "string" }, target_date: { type: "string" }, tolerance_days: { type: "integer", minimum: 0, maximum: 31 }, min_date: { type: "string" }, max_date: { type: "string" }, hint: { type: "string" }, ...presenceClueSchema }, required: ["title", "narration", "prompt", "target_date", "hint", "presence_clue"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const locked = sceneGateError(); if (locked) return locked;
          setDateValue("");
          await transitionTo({ mode: "date", eyebrow: `TURN ${game.current.turn + 1} / ${game.current.maxTurns} · CHOOSE THE DATE`, title: String(input.title), body: String(input.narration), prompt: String(input.prompt), minDate: input.min_date ? String(input.min_date) : undefined, maxDate: input.max_date ? String(input.max_date) : undefined });
          return waitForHuman({ kind: "date_puzzle", targetDate: String(input.target_date), dateToleranceDays: Number(input.tolerance_days) || 0, hint: String(input.hint), presenceClue: String(input.presence_clue) });
        }
      },
      {
        name: "third_present_item_obstacle",
        description: "Create an item-gated discovery or obstacle. The required item must already be carried. Something in the Dark automatically presents that item as an explicit action and locks the reveal until the human selects it. Use this instead of narrating item-dependent results directly.",
        inputSchema: { type: "object", properties: { obstacle_id: { type: "string", pattern: "^[a-z0-9_-]+$" }, title: { type: "string" }, narration: { type: "string" }, required_item_id: { type: "string" }, unlocked_reveal: { type: "string" }, alternate_actions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 3 }, ...presenceClueSchema }, required: ["obstacle_id", "title", "narration", "required_item_id", "unlocked_reveal", "alternate_actions", "presence_clue"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const locked = sceneGateError(); if (locked) return locked;
          const requiredItemId = String(input.required_item_id); const item = game.current.inventory.find((candidate) => candidate.id === requiredItemId);
          if (!item) return result({ error: "required_item_not_carried", inventory: game.current.inventory, protocol_instruction: "Do not reveal the locked result. Create a different obstacle or let the player discover the item first." });
          activeObstacle.current = { id: String(input.obstacle_id), requiredItemId, reveal: String(input.unlocked_reveal) };
          await transitionTo({ mode: "choice", eyebrow: `TURN ${game.current.turn + 1} / ${game.current.maxTurns} · SOMETHING MAY FIT`, title: String(input.title), body: String(input.narration), options: (input.alternate_actions as unknown[]).map(String), allowInventory: true, requiredItemId });
          return waitForHuman({ kind: "choice", allowInventory: true, requiredItemId, presenceClue: String(input.presence_clue) });
        }
      },
      {
        name: "third_resolve_item_obstacle",
        description: "Resolve the active item obstacle after the human explicitly selected its required item. Something in the Dark consumes one quantity and reveals the result that was locked before the choice.",
        inputSchema: { type: "object", properties: { ...presenceClueSchema }, required: ["presence_clue"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const obstacle = activeObstacle.current; if (!obstacle) return result({ error: "no_active_item_obstacle" });
          if (lastAction.current?.action_type !== "inventory_item" || lastAction.current.item_id !== obstacle.requiredItemId) return result({ error: "required_item_not_selected", protocol_instruction: "Do not reveal the locked result. Continue from the human's alternate action." });
          const item = game.current.inventory.find((candidate) => candidate.id === obstacle.requiredItemId); if (!item) return result({ error: "item_no_longer_carried" });
          item.quantity -= 1; if (item.quantity <= 0) game.current.inventory = game.current.inventory.filter((candidate) => candidate.id !== item.id); metrics.current.itemObstaclesResolved += 1; activeObstacle.current = null; syncGame();
          await transitionTo({ mode: "message", eyebrow: `${item.name.toUpperCase()} · 1 CONSUMED`, title: obstacle.reveal, body: item.quantity > 0 ? `${item.quantity} remaining.` : "None remain." });
          await waitForHuman({ kind: "continue", presenceClue: String(input.presence_clue) });
          return result({ obstacle_resolved: obstacle.id, item_used: item.name, remaining_quantity: Math.max(0, item.quantity), unlocked_reveal: obstacle.reveal, game_state: game.current, protocol_instruction: "End this tool turn. Wait until the human says next." });
        }
      },
      {
        name: "third_present_pickups",
        description: "Show 2–3 physical objects in the scene and let the human choose one to carry or leave them all. Nothing enters inventory until the human selects it. Each option must enable a meaningfully different later path, puzzle, or confrontation; leaving them must also have consequences.",
        inputSchema: { type: "object", properties: { title: { type: "string" }, narration: { type: "string" }, items: { type: "array", minItems: 2, maxItems: 3, items: { type: "object", properties: { id: { type: "string", pattern: "^[a-z0-9_-]+$" }, name: { type: "string" }, description: { type: "string" }, quantity: { type: "integer", minimum: 1, maximum: 3 } }, required: ["id", "name", "description", "quantity"], additionalProperties: false } }, ...presenceClueSchema }, required: ["title", "narration", "items", "presence_clue"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const locked = sceneGateError(); if (locked) return locked;
          if (game.current.inventory.length >= 4) return result({ error: "inventory_full", inventory: game.current.inventory, protocol_instruction: "Do not offer more objects until space is created." });
          const pickups = (input.items as Array<Record<string, unknown>>).map((entry) => ({ id: String(entry.id), name: String(entry.name), description: String(entry.description), quantity: Math.max(1, Math.min(3, Number(entry.quantity))) }));
          if (new Set(pickups.map((item) => item.id)).size !== pickups.length) return result({ error: "pickup_ids_must_be_unique" });
          await transitionTo({ mode: "pickup", eyebrow: `TURN ${game.current.turn + 1} / ${game.current.maxTurns} · TAKE ONE`, title: String(input.title), body: String(input.narration), pickups });
          return waitForHuman({ kind: "pickup", pickups, presenceClue: String(input.presence_clue) });
        }
      },
      {
        name: "third_present_presence_confrontation",
        description: "When the Presence reaches maximum threat, privately lock the odds before showing the human one survival choice: use one carried item or attempt a specific escape. Difficulty 7 is impossible on a d6. Never disclose the odds before the choice.",
        inputSchema: { type: "object", properties: { title: { type: "string" }, narration: { type: "string" }, escape_action: { type: "string", minLength: 8, description: "A concrete desperate attempt appropriate to the scene, such as vault the railing or dive through the service hatch." }, escape_difficulty: { type: "integer", minimum: 2, maximum: 7 }, item_difficulties: { type: "array", items: { type: "object", properties: { item_id: { type: "string" }, difficulty: { type: "integer", minimum: 2, maximum: 7 } }, required: ["item_id", "difficulty"], additionalProperties: false } }, ...presenceClueSchema }, required: ["title", "narration", "escape_action", "escape_difficulty", "item_difficulties", "presence_clue"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          if (game.current.threat < game.current.maxThreat) return result({ error: "presence_not_here_yet", presence_approach: approachState(game.current.threat, game.current.maxThreat) });
          const entries = input.item_difficulties as Array<Record<string, unknown>>;
          const carriedIds = game.current.inventory.map((item) => item.id).sort(); const suppliedIds = entries.map((entry) => String(entry.item_id)).sort();
          if (new Set(suppliedIds).size !== suppliedIds.length || JSON.stringify(carriedIds) !== JSON.stringify(suppliedIds)) return result({ error: "difficulty_required_for_every_carried_item", carried_item_ids: carriedIds });
          presencePlan.current = { escapeDifficulty: Number(input.escape_difficulty), itemDifficulties: Object.fromEntries(entries.map((entry) => [String(entry.item_id), Number(entry.difficulty)])) };
          presenceEncounter.current = true; presenceItemCommitted.current = false; presenceEscapeCommitted.current = false; metrics.current.presenceConfronted = false;
          await transitionTo({ mode: "choice", eyebrow: `${story.current.presence.toUpperCase()} · HERE`, title: String(input.title), body: String(input.narration), options: [], allowInventory: game.current.inventory.length > 0, presenceConfrontation: true, escapeOption: String(input.escape_action) });
          return waitForHuman({ kind: "choice", allowInventory: true, presenceClue: String(input.presence_clue) });
        }
      },
      {
        name: "third_use_item",
        description: "Resolve an inventory item the human explicitly selected. Something in the Dark consumes exactly one quantity and can apply one small effect. During a Presence confrontation, call with effect none; the required roll determines the consequence.",
        inputSchema: { type: "object", properties: { item_id: { type: "string" }, narration: { type: "string" }, effect: { type: "string", enum: ["none", "reduce_threat"] }, effect_amount: { type: "integer", minimum: 1, maximum: 2 }, ...presenceClueSchema }, required: ["item_id", "narration", "effect", "presence_clue"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const locked = itemGateError(); if (locked) return locked;
          const item = game.current.inventory.find((candidate) => candidate.id === String(input.item_id)); if (!item) return result({ error: "item_not_in_inventory", inventory: game.current.inventory });
          if (presenceEncounter.current && (lastAction.current?.action_type !== "presence_item" || lastAction.current.item_id !== item.id)) return result({ error: "use_the_item_the_human_selected", selected_item_id: lastAction.current?.item_id });
          if (presenceEncounter.current && String(input.effect) !== "none") return result({ error: "confrontation_effect_belongs_to_roll", protocol_instruction: "Use this item with effect none. The next roll will either move the Presence back 2 spaces or kill the player." });
          const amount = Math.max(1, Math.min(2, Number(input.effect_amount) || 1)); const effect = String(input.effect);
          if (effect === "reduce_threat") game.current.threat = Math.max(0, game.current.threat - amount);
          item.quantity -= 1; if (item.quantity <= 0) game.current.inventory = game.current.inventory.filter((candidate) => candidate.id !== item.id); if (presenceEncounter.current) presenceItemCommitted.current = true; syncGame();
          await transitionTo({ mode: "message", eyebrow: `${item.name.toUpperCase()} · USED`, title: String(input.narration), body: effect === "none" ? "Nothing in this place is spent without consequence." : "The balance of the room changes." });
          await waitForHuman({ kind: "continue", presenceClue: String(input.presence_clue) });
          return result({ item_used: item.name, remaining_quantity: Math.max(0, item.quantity), effect, amount: effect === "none" ? 0 : amount, presence_roll_required: presenceItemCommitted.current, game_state: game.current, protocol_instruction: "End this tool turn. Wait until the human says next." });
        }
      },
      {
        name: "third_change_state",
        description: "Apply a non-random consequence already earned by a solved or failed puzzle. Use roll_dice for uncertain outcomes.",
        inputSchema: { type: "object", properties: { change: { type: "string", enum: ["advance_threat", "reduce_threat"] }, amount: { type: "integer", minimum: 1, maximum: 2 }, reason: { type: "string" } }, required: ["change", "amount", "reason"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const amount = Math.max(1, Math.min(2, Number(input.amount))); const change = String(input.change);
          if (change === "advance_threat") game.current.threat = Math.min(game.current.maxThreat, game.current.threat + amount);
          if (change === "reduce_threat") game.current.threat = Math.max(0, game.current.threat - amount);
          syncGame(); return result({ applied: change, amount, reason: String(input.reason), game_state: game.current, protocol_instruction: "Continue immediately." });
        }
      },
      {
        name: "roll_dice",
        description: "Present a genuinely uncertain danger, attack, or escape attempt and wait for the human to press the visible Roll the die button. Never roll immediately. The situation and roll_action must follow from a human choice already made or an unavoidable immediate danger. If the Presence is HERE, never call this until third_present_presence_confrontation has displayed the player's item-or-escape choice and the human has selected one. During that confrontation this is the player's single survival roll: success always moves it back 2 spaces to Close; failure always kills the player.",
        inputSchema: { type: "object", properties: { title: { type: "string", minLength: 3 }, narration: { type: "string", minLength: 12 }, roll_action: { type: "string", minLength: 3, description: "The exact action the human will choose to attempt by pressing the roll button." }, reason: { type: "string" }, difficulty: { type: "integer", minimum: 2, maximum: 6, description: "Used only for ordinary uncertainty. Presence confrontations use the hidden difficulty committed before the player chose." }, success_narration: { type: "string" }, failure_narration: { type: "string" }, success_effect: { type: "string", enum: ["none", "reduce_threat"] }, failure_effect: { type: "string", enum: ["none", "advance_threat"] }, effect_amount: { type: "integer", minimum: 1, maximum: 2 }, ...presenceClueSchema }, required: ["title", "narration", "roll_action", "reason", "difficulty", "success_narration", "failure_narration", "success_effect", "failure_effect", "presence_clue"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const locked = itemGateError(); if (locked) return locked;
          if (pendingRollResult.current) return result({ error: "roll_result_must_be_shown", pending_roll_result: pendingRollResult.current, protocol_instruction: "Call third_show now to reveal this roll's meaning before rolling again." });
          if (game.current.threat >= game.current.maxThreat && !presenceEncounter.current) return result({ error: "presence_choice_not_presented", protocol_instruction: "The Presence is HERE. Call third_present_presence_confrontation now. It must show the human their carried-item options and the escape action before any roll." });
          const presenceAttempt = presenceItemCommitted.current || presenceEscapeCommitted.current;
          if (presenceEncounter.current && !presenceAttempt) return result({ error: "survival_choice_required", protocol_instruction: "Wait for the human to choose one item or the escape action before rolling." });
          if (presenceAttempt && !presencePlan.current) return result({ error: "presence_odds_not_committed", protocol_instruction: "Call third_present_presence_confrontation again and commit the odds before asking the human to choose." });
          const selectedItemId = String(lastAction.current?.item_id || "");
          const lockedDifficulty = presenceEscapeCommitted.current ? presencePlan.current?.escapeDifficulty : presencePlan.current?.itemDifficulties[selectedItemId];
          if (presenceAttempt && !lockedDifficulty) return result({ error: "selected_method_has_no_committed_difficulty", selected_item_id: selectedItemId });
          const difficulty = presenceAttempt ? Number(lockedDifficulty) : Math.max(2, Math.min(6, Number(input.difficulty)));
          await transitionTo({ mode: "dice", eyebrow: `THE DIE WAITS · NEED ${difficulty}+`, title: String(input.title), body: String(input.narration), prompt: String(input.roll_action), diceRolling: false });
          return waitForHuman({ kind: "dice_roll", presenceClue: String(input.presence_clue), diceReason: String(input.reason), diceDifficulty: difficulty, successNarration: String(input.success_narration), failureNarration: String(input.failure_narration), successEffect: String(input.success_effect), failureEffect: String(input.failure_effect), effectAmount: Number(input.effect_amount) || 1 });
        }
      },
      {
        name: "third_complete",
        description: "End with one concrete, restrained final scene. Keep the whole story to 8 human turns or fewer. An early successful escape requires 4 turns, 2 solved puzzles using 2 different controls, 1 player-chosen item type, 1 resolved item obstacle, 1 dice roll, and 1 callback. If the Presence arrived, it must have been successfully confronted. For outcome lost after a failed Presence roll, write the player's death scene. Keep the prose lived-in, plainspoken, specific, and unsettling without melodrama; end on a precise physical detail rather than a grand statement. Never include a recap, evidence, lesson, psychological interpretation, hidden intention, or explanation of what the player learned.",
        inputSchema: { type: "object", properties: { outcome: { type: "string", enum: ["escaped", "lost"] }, title: { type: "string" }, body: { type: "string", minLength: 40, description: "Only the final scene, written as story prose. When outcome is lost, describe the death itself and its final image or sound." }, artifact_name: { type: "string" } }, required: ["outcome", "title", "body"], additionalProperties: false },
        execute: async (input: Record<string, unknown>) => {
          const locked = itemGateError(); if (locked) return locked;
          const outcome = String(input.outcome); const atLimit = game.current.turn >= game.current.maxTurns; const dead = !game.current.alive; const arrivalUnresolved = game.current.threat >= game.current.maxThreat; const escapeReady = game.current.turn >= 4 && metrics.current.solvedPuzzles >= 2 && metrics.current.puzzleTypes.size >= 2 && metrics.current.itemsChosen.size >= 1 && metrics.current.itemObstaclesResolved >= 1 && metrics.current.diceRolls >= 1 && metrics.current.callbacks.size >= 1;
          if (outcome === "escaped" && arrivalUnresolved) return result({ error: "presence_must_be_faced", protocol_instruction: "The Presence arrived before escape. The player must confront it successfully or lose." });
          if (outcome === "escaped" && !escapeReady && !atLimit) return result({ error: "escape_not_earned", requirements: { turns: `${game.current.turn}/4`, puzzles: `${metrics.current.solvedPuzzles}/2`, puzzle_types: `${metrics.current.puzzleTypes.size}/2`, item_types: `${metrics.current.itemsChosen.size}/1`, item_obstacles: `${metrics.current.itemObstaclesResolved}/1`, dice: `${metrics.current.diceRolls}/1`, callbacks: `${metrics.current.callbacks.size}/1` } });
          if (outcome === "lost" && !dead) return result({ error: "loss_not_earned", protocol_instruction: "Only a failed survival attempt against the Presence can kill the player. Continue the escape story." });
          await transitionTo({ mode: "complete", eyebrow: outcome.replaceAll("_", " ").toUpperCase(), title: String(input.title), body: String(input.body), artifactName: input.artifact_name ? String(input.artifact_name) : undefined }); setStatus("complete");
          return result({ completed: true, outcome, game_state: game.current });
        }
      }
    ];
    let alive = true; Promise.all(tools.map((tool) => context.registerTool(tool))).then(() => alive && setToolSupport("ready")).catch(() => alive && setToolSupport("unavailable"));
    return () => { alive = false; tools.forEach((tool) => context.unregisterTool?.(tool.name)); if (pending.current) { pending.current.resolve(result({ cancelled: true })); pending.current = null; } };
  }, [handBack, syncGame, transitionTo, waitForHuman]);

  const consent = async (accepted: boolean) => {
    const current = pending.current; if (!current) return; pending.current = null; setPendingKind(null); sessionStarted.current = accepted; setGameStarted(accepted);
    await transitionTo(accepted ? { mode: "handoff", eyebrow: "THE PRESENCE · DISTANT", title: story.current.openingClue, body: "Type “next” in ChatGPT when you are ready." } : { mode: "threshold", eyebrow: "SOMETHING IN THE DARK / CLOSED", title: "The dark remains outside.", body: "The invitation was declined." });
    if (!accepted) { fear.current = ""; story.current = initialStory(); setStoryView(initialStory()); }
    current.resolve(result({ consent: accepted ? "granted" : "declined", source: "human", protocol_instruction: accepted ? "End this turn. When the human says next, call next_third." : "Stop." })); setStatus(accepted ? "active" : "listening");
  };

  const reset = () => {
    if (pending.current) pending.current.resolve(result({ cancelled: true, reason: "game_reset" })); pending.current = null;
    sessionStarted.current = false; fear.current = ""; story.current = initialStory(); game.current = initialGame(); history.current = []; lastAction.current = null; activeObstacle.current = null; presenceEncounter.current = false; presenceItemCommitted.current = false; presenceEscapeCommitted.current = false; presencePlan.current = null; pendingRollResult.current = null; metrics.current = { itemsChosen: new Set<string>(), solvedPuzzles: 0, puzzleTypes: new Set<string>(), itemObstaclesResolved: 0, diceRolls: 0, callbacks: new Set<number>(), presenceConfronted: false };
    setStoryView(initialStory()); setSnapshot(initialGame()); setGameStarted(false); setPendingKind(null); setText(""); setFearText(""); setStatus("listening"); void transitionTo({ mode: "threshold", eyebrow: "SOMETHING IN THE DARK / HORROR 001", title: "Something is waiting in the dark.", body: "Enter when you are ready." });
  };

  const canUseInventory = Boolean(stage.allowInventory && pendingKind && snapshot.inventory.length);

  return <main className={`stage-shell mode-${stage.mode}`}>
    <div className="grain" aria-hidden="true" />
    <header className="masthead"><a className="wordmark" href="#" onClick={(event) => { event.preventDefault(); reset(); }}>SOMETHING IN THE DARK<span>•</span></a><div className="signal"><i className={toolSupport === "ready" ? "live" : ""} />{toolSupport === "ready" ? "AI CHANNEL OPEN" : toolSupport === "unavailable" ? "OPEN IN AN AI BROWSER" : "LISTENING"}</div></header>
    {gameStarted && <section className="game-hud" aria-label="Game state">
      <div className="hud-block threat"><span>{storyView.presence || "THE PRESENCE"} · {approachState(snapshot.threat, snapshot.maxThreat).label}</span><strong>{Array.from({ length: snapshot.maxThreat }, (_, index) => <i key={index} className={index < snapshot.threat ? "filled" : ""} />)}</strong><small>{approachState(snapshot.threat, snapshot.maxThreat).line}</small></div>
    </section>}
    <div className={gameStarted ? "game-layout" : "game-layout solo"}>
      <section className="stage" aria-live="polite">
        <ScrambleText as="p" className="eyebrow" text={stage.eyebrow || ""} phase={transitionPhase} />
        <ScrambleText as="h1" text={stage.title} phase={transitionPhase} />
        {stage.body && <ScrambleText as="p" className="body-copy" text={stage.body} phase={transitionPhase} />}
        {stage.mode === "threshold" && pendingKind === "consent" && <div className="actions"><button className="primary" onClick={() => consent(true)}>Enter the dark <span>↗</span></button><button className="quiet" onClick={() => consent(false)}>Not now</button></div>}
        {stage.mode === "threshold" && !pendingKind && <div className="actions"><button className="primary" onClick={() => void openFearForm()}>Enter the dark <span>↗</span></button></div>}
        {stage.mode === "fear" && pendingKind === "fear" && <div className="puzzle-card fear-card"><label htmlFor="fear-answer">Name it. Describe it. Or give it only one word.</label><textarea id="fear-answer" value={fearText} onChange={(event) => setFearText(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submitFear(); }} placeholder="Spiders. Being buried alive. A smiling face outside my window…" autoFocus maxLength={500} /><button className="primary" disabled={!fearText.trim()} onClick={() => void submitFear()}>Give it to the dark <span>↗</span></button></div>}
        {stage.mode === "handoff" && <div className="waiting-copy"><span className="pulse" /> The connection continues in chat</div>}
        {(stage.mode === "message" || stage.mode === "dice") && pendingKind === "continue" && <div className="actions reading-action"><button className="primary" onClick={acknowledge}>Continue when ready <span>↗</span></button></div>}
        {stage.mode === "choice" && Boolean(stage.options?.length) && <div className="choice-grid">{stage.options?.map((option, index) => <button key={`${index}-${option}`} onClick={() => choose(option, index)}><span>0{index + 1}</span>{option}</button>)}</div>}
        {stage.mode === "pickup" && <div className="pickup-grid">{stage.pickups?.map((item, index) => <button key={item.id} onClick={() => choosePickup(item)}><span>0{index + 1} · TAKE</span><strong>{item.name} <b>×{item.quantity}</b></strong><small>{item.description}</small></button>)}<button className="leave-pickups" onClick={leavePickups}><span>LEAVE</span><strong>Take nothing</strong><small>Move on with empty hands.</small></button></div>}
        {stage.mode === "direction" && <div className="direction-grid">{stage.directions?.map((entry) => <button key={`${entry.direction}-${entry.label}`} className={`direction-${entry.direction}`} onClick={() => chooseDirection(entry)}><span>{entry.direction === "left" ? "←" : entry.direction === "right" ? "→" : entry.direction === "up" || entry.direction === "forward" ? "↑" : "↓"}</span><strong>{entry.label}</strong><small>{entry.direction}</small></button>)}</div>}
        {stage.mode === "puzzle" && <div className="puzzle-card"><label htmlFor="puzzle-answer">{stage.prompt}</label><input id="puzzle-answer" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitPuzzle(); }} placeholder="Your answer…" autoFocus maxLength={300} /><button className="primary" disabled={!text.trim()} onClick={submitPuzzle}>Try the lock <span>↗</span></button></div>}
        {stage.mode === "scale" && <div className="instrument-card"><label>{stage.prompt}</label><div className="scale-value"><strong>{scaleValue}</strong><span>/ 100</span></div><input className="scale-input" type="range" min="0" max="100" value={scaleValue} style={{ "--scale-progress": scaleValue } as CSSProperties} onChange={(event) => setScaleValue(Number(event.target.value))} aria-label={stage.prompt} /><div className="scale-labels"><span>{stage.lowLabel}</span><span>{stage.highLabel}</span></div><button className="primary" onClick={submitScale}>Set the level <span>↗</span></button></div>}
        {stage.mode === "color" && <div className="instrument-card color-card"><label>{stage.prompt}</label><input className="color-input" type="color" value={colorValue} onChange={(event) => setColorValue(event.target.value)} aria-label={stage.prompt} /><output>{colorValue.toUpperCase()}</output><button className="primary" onClick={submitColor}>Match the signal <span>↗</span></button></div>}
        {stage.mode === "date" && <div className="instrument-card"><label htmlFor="date-answer">{stage.prompt}</label><input id="date-answer" className="date-input" type="date" value={dateValue} min={stage.minDate} max={stage.maxDate} onChange={(event) => setDateValue(event.target.value)} /><button className="primary" disabled={!dateValue} onClick={submitDate}>Choose the date <span>↗</span></button></div>}
        {stage.mode === "dice" && (stage.diceRolling || stage.diceValue !== undefined) && <DieRoll value={stage.diceValue} rolling={stage.diceRolling} />}
        {stage.mode === "dice" && pendingKind === "dice_roll" && !stage.diceRolling && <div className="actions reading-action"><button className="primary" onClick={() => void rollDie()}>{stage.prompt || "Roll the die"} <span>↗</span></button></div>}
        {canUseInventory && <div className="use-inventory"><p>{stage.presenceConfrontation ? `Choose what you will use against ${storyView.presence}` : stage.requiredItemId ? "Use the item that fits" : "Or use something you carry"}</p>{snapshot.inventory.filter((item) => !stage.requiredItemId || item.id === stage.requiredItemId).map((item) => <button key={item.id} onClick={() => chooseItem(item)}><span>{item.name} <b>×{item.quantity}</b></span><small>{item.description}</small></button>)}</div>}
        {stage.presenceConfrontation && stage.escapeOption && <div className="presence-escape"><p>OR TRUST YOUR FEET</p><button onClick={choosePresenceEscape}><span>ESCAPE</span><strong>{stage.escapeOption}</strong><small>One roll. No second chance.</small></button></div>}
        {stage.mode === "complete" && <div className="completion">{stage.artifactName && <p>YOU LEFT WITH: <strong>{stage.artifactName}</strong></p>}<button className="quiet" onClick={reset}>Enter again</button></div>}
      </section>
      {gameStarted && <aside className="inventory-panel">
        <header><span>INVENTORY</span><small>{snapshot.inventory.length} / 4</small></header>
        <div className="inventory-slots">{Array.from({ length: 4 }, (_, index) => { const item = snapshot.inventory[index]; return <div key={index} className={item ? "occupied" : ""}>{item ? <><strong>{item.name} <b>×{item.quantity}</b></strong><p>{item.description}</p><small>QUANTITY {item.quantity}</small></> : <span>EMPTY</span>}</div>; })}</div>
      </aside>}
    </div>
    <footer><p>Created by <a href="https://x.com/Texchnostack" target="_blank" rel="noreferrer">@Texchnostack</a></p><p className="status-line">{status === "waiting" ? "YOUR MOVE" : status === "complete" ? "THE STORY REMEMBERS" : gameStarted ? "ESCAPE BEFORE IT ARRIVES" : "ONE HUMAN · ONE AI · ONE WAY OUT"}</p></footer>
  </main>;
}
