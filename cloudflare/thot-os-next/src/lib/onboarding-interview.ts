export type InterviewQuestion = { id: string; chapter: string; title: string; prompt: string; help: string; field?: string; maxLength?: number };

export const INTERVIEW_QUESTIONS: readonly InterviewQuestion[] = [
  { id: "stage_name", chapter: "Who is the online you?", title: "What should we call you online?", prompt: "What is your creator or stage name?", help: "This is the name THOT OS uses across your creator workspace.", field: "stage_name", maxLength: 100 },
  { id: "short_bio", chapter: "Who is the online you?", title: "Give us the quick version", prompt: "How would you introduce your online self in a short bio?", help: "A rough answer is perfect. Your assistant can help polish it without inventing facts.", field: "short_bio", maxLength: 1000 },
  { id: "voice", chapter: "Who is the online you?", title: "What does your voice feel like?", prompt: "How should your writing sound? Add a few words, examples or a vibe.", help: "Only what you confirm is saved; your assistant cannot invent experiences or feelings.", field: "voice_summary", maxLength: 2000 },
  { id: "interests", chapter: "Who is the online you?", title: "What are you genuinely into?", prompt: "Tell us about the interests you are comfortable using in creator content.", help: "Keep private interests out if you do not want the agency or AI to reference them.", field: "interests", maxLength: 2000 },
  { id: "themes", chapter: "Who is the online you?", title: "What do you want to create?", prompt: "What content themes or niches should we build around?", help: "This helps shape future growth ideas without authorising any automatic posting.", field: "niches_themes", maxLength: 2000 },
  { id: "boundaries", chapter: "Who is the online you?", title: "What stays off limits?", prompt: "List topics, claims or requests that THOT OS should avoid.", help: "Hard boundaries are useful, not awkward.", field: "hard_boundaries", maxLength: 2000 },
  { id: "goals", chapter: "Who is the online you?", title: "What are we building toward?", prompt: "What would you most like THOT OS and the agency to help you grow?", help: "This guides recommendations; it does not approve publishing or messaging.", field: "growth_priorities", maxLength: 2000 },
  { id: "review", chapter: "Who is the online you?", title: "Your online-you review", prompt: "Review the answers you confirmed before sending this chapter to the agency.", help: "You can return and change any answer later." },
];
export const INTERVIEW_FIELDS = new Set(INTERVIEW_QUESTIONS.flatMap((q) => q.field ? [q.field] : []));
export function nextInterviewIndex(values: Record<string, string>) { const index = INTERVIEW_QUESTIONS.findIndex((q) => q.field && !values[q.field]?.trim()); return index === -1 ? INTERVIEW_QUESTIONS.length - 1 : index; }
