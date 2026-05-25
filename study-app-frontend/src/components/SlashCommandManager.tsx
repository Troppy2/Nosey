import { Bot, Layers3, MessageCircle, Plus, RotateCcw, Search, Sparkles, Trash2, type LucideIcon } from "lucide-react";
import { SlashCommandMenu, type SlashCommand } from "../components/SlashCommandMenu";

type PromptState = "Published" | "Draft" | "Pinned";

type ManagedPrompt = {
    slash: string;
    label: string;
    description: string;
    prompt: string;
    status: PromptState;
    icon: LucideIcon;
};

const CHAT_COMMANDS: SlashCommand[] = [
    { slash: "/summarize", label: "Summarize", description: "Pull out the big ideas from this folder.", prompt: "Summarize the most important ideas in this folder." },
    { slash: "/quiz", label: "Quiz Me", description: "Turn the notes into quick review questions.", prompt: "Quiz me on the most important material in this folder." },
    { slash: "/review", label: "Review Mistakes", description: "Go over recent wrong answers.", prompt: "Review the wrong answers from my most recent test." },
    { slash: "/focus", label: "Study Focus", description: "Prioritize what to study next.", prompt: "What should I focus on next based on these notes?" },
    { slash: "/explain", label: "Explain", description: "Break down a confusing concept.", prompt: "Help me understand the hardest idea in these notes." },
    { slash: "/flashcards", label: "Flashcards", description: "Surface terms worth memorizing.", prompt: "What terms or facts from this folder would make strong flashcards?" },
];

const MANAGED_PROMPTS: ManagedPrompt[] = [
    {
        slash: "/teach-back",
        label: "Teach Back",
        description: "Ask Kojo to explain the idea in plain language and end with a quick check question.",
        prompt: "Explain this topic like I am teaching it to someone else. Keep it simple, concrete, and end with one question I should answer.",
        status: "Published",
        icon: Bot,
    },
    {
        slash: "/quiz-me-hard",
        label: "Quiz Me Hard",
        description: "Turn notes into a tougher practice prompt that pushes beyond memorization.",
        prompt: "Quiz me with a harder-than-usual prompt that tests understanding, not just recall.",
        status: "Pinned",
        icon: Layers3,
    },
    {
        slash: "/simple-example",
        label: "Simple Example",
        description: "Request a short example that makes a concept easier to picture.",
        prompt: "Give me one simple example that makes this idea easier to understand.",
        status: "Draft",
        icon: Sparkles,
    },
];

const PROMPT_STATS = [
    { label: "Published", value: "6" },
    { label: "Drafts", value: "3" },
    { label: "Pinned", value: "2" },
];

export default function SlashCommandManager() {
    return (
        <section className="slash-manager" aria-label="Slash command manager">
            <div className="slash-manager-hero">
                <div className="slash-manager-kicker">
                    <Sparkles size={14} />
                    <span>Kojo prompt studio</span>
                </div>

                <div className="slash-manager-hero-row">
                    <div>
                        <h2>Slash command manager</h2>
                        <p>
                            Draft custom prompts, organize the ones you want to keep, and preview how they will appear in Kojo.
                        </p>
                    </div>

                    <div className="slash-manager-stats" aria-label="Prompt counts">
                        {PROMPT_STATS.map((stat) => (
                            <div key={stat.label} className="slash-manager-stat">
                                <strong>{stat.value}</strong>
                                <span>{stat.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="slash-manager-grid">
                <article className="slash-manager-panel slash-manager-panel--composer">
                    <div className="slash-manager-panel-header">
                        <div>
                            <span className="slash-manager-eyebrow">
                                <Plus size={13} />
                                <span>Create prompt</span>
                            </span>
                            <h3>Design a reusable Kojo command</h3>
                        </div>

                        <span className="slash-manager-panel-note">Draft only for now</span>
                    </div>

                    <div className="slash-manager-form">
                        <label className="slash-manager-field">
                            <span>Slash trigger</span>
                            <input type="text" placeholder="/my-prompt" aria-label="Slash trigger" />
                        </label>

                        <label className="slash-manager-field">
                            <span>Prompt name</span>
                            <input type="text" placeholder="Explain simply" aria-label="Prompt name" />
                        </label>

                        <label className="slash-manager-field">
                            <span>Kojo instruction</span>
                            <textarea rows={6} placeholder="Tell Kojo exactly what you want it to do..." aria-label="Kojo instruction" />
                        </label>

                        <div className="slash-manager-row">
                            <label className="slash-manager-field">
                                <span>Category</span>
                                <select aria-label="Prompt category" defaultValue="study-help">
                                    <option value="study-help">Study help</option>
                                    <option value="quiz">Quiz</option>
                                    <option value="review">Review</option>
                                    <option value="summary">Summary</option>
                                </select>
                            </label>

                            <label className="slash-manager-field">
                                <span>Visibility</span>
                                <select aria-label="Prompt visibility" defaultValue="private">
                                    <option value="private">Private</option>
                                    <option value="pinned">Pinned</option>
                                    <option value="shared">Shared pack</option>
                                </select>
                            </label>
                        </div>

                        <div className="slash-manager-actions">
                            <button type="button" className="slash-manager-secondary-button">
                                <MessageCircle size={14} />
                                <span>Preview prompt</span>
                            </button>
                            <button type="button" className="slash-manager-primary-button">
                                <Sparkles size={14} />
                                <span>Save prompt</span>
                            </button>
                        </div>
                    </div>
                </article>

                <aside className="slash-manager-panel slash-manager-panel--preview">
                    <div className="slash-manager-panel-header">
                        <div>
                            <span className="slash-manager-eyebrow">
                                <Search size={13} />
                                <span>Live menu preview</span>
                            </span>
                            <h3>How Kojo will show it</h3>
                        </div>

                        <span className="slash-manager-panel-note">Menu-only view</span>
                    </div>

                    <div className="slash-manager-preview-stage">
                        <div className="slash-manager-preview-input">
                            <Search size={14} />
                            <div>
                                <strong>/ex</strong>
                                <span>Type a slash command to narrow the list.</span>
                            </div>
                        </div>

                        <SlashCommandMenu commands={CHAT_COMMANDS} query="" onSelect={() => undefined} />
                    </div>
                </aside>
            </div>

            <section className="slash-manager-library" aria-label="Saved prompts">
                <div className="slash-manager-library-header">
                    <div>
                        <span className="slash-manager-eyebrow">
                            <Layers3 size={13} />
                            <span>Saved prompts</span>
                        </span>
                        <h3>Prompt library</h3>
                    </div>

                    <p>Keep a small set of commands ready to ship before they are connected to Kojo.</p>
                </div>

                <div className="slash-manager-card-grid">
                    {MANAGED_PROMPTS.map((prompt) => {
                        const Icon = prompt.icon;

                        return (
                            <article key={prompt.slash} className="slash-manager-card">
                                <div className="slash-manager-card-top">
                                    <div className="slash-manager-card-title">
                                        <span className="slash-manager-card-icon">
                                            <Icon size={15} />
                                        </span>
                                        <div>
                                            <strong>{prompt.label}</strong>
                                            <span>{prompt.slash}</span>
                                        </div>
                                    </div>

                                    <span className={`slash-manager-status slash-manager-status--${prompt.status.toLowerCase()}`}>
                                        {prompt.status}
                                    </span>
                                </div>

                                <p>{prompt.description}</p>

                                <div className="slash-manager-card-prompt">{prompt.prompt}</div>

                                <div className="slash-manager-card-actions">
                                    <button type="button">
                                        <RotateCcw size={13} />
                                        <span>Duplicate</span>
                                    </button>
                                    <button type="button">
                                        <Trash2 size={13} />
                                        <span>Remove</span>
                                    </button>
                                </div>
                            </article>
                        );
                    })}
                </div>
            </section>
        </section>
    );
}