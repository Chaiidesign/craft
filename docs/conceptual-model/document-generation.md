# Conceptual model: making documents with Souvenir

**Status:** Round 1, forced choices. Stages 0–1 are drafted; nothing past the frame is modelled yet.
**Driver:** Chai (domain owner; owns the vocabulary). **Drafter:** Claude.
**Method:** Johnson & Henderson, *Conceptual Models*, run with the `conceptual-model` skill (`running-a-session.md`, four rounds).

---

## Stage 0: inputs

### Prior models (read first, position 0)

| # | Prior model | What it is | Can it be the baseline? |
|---|---|---|---|
| P1 | `docs/design-system/2-master-concept-map.md` (the "Master Concept Map, Souvenir V2 Frontend", a Mermaid diagram) | A map of the team, codebase, design system, endpoints and chat UI phases | **No.** Almost every node is a person, a repo, an endpoint, a component or a screen state. Those are implementation concepts (F6) and presentation concepts (F4), not concepts a user meets. It's useful as a coverage check, not as a model. |
| P2 | The "unified Dubberly concept map" of 2026-04-29, in FigJam (V2 approach) | Not in the repo; not read | **Unknown.** Chai to share it, or confirm it's superseded. |
| P3 | `docs/souvenir-document-generation-prd.md` §5 (Document, Revision, DocumentSnapshot, Field, Block, BrandProfile, ExportRecord), plus decisions D-49 to D-67 | The contract behind the document engine in the `craft` fork | **Partly.** It's the closest thing to a model, but it's written as TypeScript contracts. Snapshot, Block and ExportRecord are architecture. Document, Revision, Field-missing and Brand are good user concepts. |

**Proposed declaration:** none of the three is authoritative for *making documents in chat*. This model is a **new component model** (§6.2.3) inside Souvenir's overall chat model. It inherits P3's user-facing vocabulary where P3 has one, and records every departure as a change. *Chai to confirm, and to say whether P2 exists and covers this.*

### Narrative (source of concepts)

- **No user research for this area:** no user profiles, no task analysis, no interview transcripts.
- **Substitutes, named honestly:**
  1. Chai's domain knowledge, as co-founder and product designer.
  2. The two invoice-PDF trouble reports in PRD §3:
     - Souvenir branding was used instead of the issuer's.
     - Missing facts were listed in prose, not beside the fields they belong to.
     - Currency appeared differently in the chat and the PDF.
  3. Tonight's baseline run (`docs/reports/doc-gen-loop/summary.md`), which records what the product **does**, not how people talk.
- **Weakness:** every term so far comes from designers, engineers or the model. None comes from someone who needed a document. The vocabulary in Round 2 has to be tested with two or three real users before it's treated as settled (Stage 10).

### Current product surface (a test, not a source)

User-visible names found so far, across the real chat and the `/document-chat` prototype:

- **Real chat:** "Download the …" link; file chip with **View** and **Download**; "DOCX" badge; "Thinking · Preparing document creation"; "Ran 4 actions — Loading skill, Running tool, Running sandbox command"; "Thought for 1m 18s"; ArtifactCard "Draft v{N}" and "See history".
- **Prototype:** "Draft · 10 missing", "Not provided yet", "version", "Updated to v2", "New document", "Download PDF", "Download Word".

Already visible without modelling anything:
- **One thing, several names (§9.1):** the made thing is called a *file*, an *artifact*, a *document*, a *draft* and an *output*. A change is a *version*, a *revision* and a *draft*.
- **One name, several things:** ArtifactCard is used for documents and also for scheduled events and saved items.
- **System terms shown to users (F6):** "sandbox command", "tool", "skill".

### Architecture (coverage check only; read last)

Backend: `generated_file` and `docx_progress` events, python-docx code run in a sandbox, files kept in cloud storage, skills. Prototype engine: snapshot, block, digest, export record, gate.

None of these is a user concept unless it can justify itself to a user (provenance rule: `[A]`-only gets hidden).

**Gate 0:** the substitute for research is named and its weakness is stated. **Passed.**

---

## Stage 1: frame

### Overall purpose (draft)

For people at small companies and agencies who need a finished business document: an invoice, brief, memo, report, proposal, form, contract template, deck or data file. They describe what they need in conversation. Souvenir drafts it, shows it, changes it when asked, never invents facts it wasn't given, and hands back a file they can send.

### Task domain

Making a business document someone else will read: drafting it, filling in its facts, correcting and refining it, checking it's ready, and sending it on as a file.

### Out of scope

- How the chat looks, the layout of the thinking state, and visual design
- Rendering engines and file-format internals
- Backend services, storage, the sandbox and skills
- Authentication and billing
- Live collaboration and comments, and approval workflows (P3 already excludes these)

### Root concept: **pending Chai's choice 1 below**

**Gate 1:** Chai confirms the root concept and the scope boundary. **Not yet passed.**

---

## Round 1: forced choices (§2.5)

Each is a) or b). The leaning is the drafter's; the choice is Chai's.

| # | Choice | a) | b) | Leaning |
|---|---|---|---|---|
| 1 | **Root concept** | **Document**: a lasting thing that has versions and can be exported as files | **File**: each request produces a standalone file, as the product does today | **a)**. Today's product is (b) by accident: each request gives an unrelated file, delivered two different ways, with no link between them. The PRD's goals (revisions keep untouched content; an export is exactly one version) only make sense under (a). |
| 2 | **Where a document starts** | Only replies that can be exported and versioned are documents. A table or a short email in the chat is just a reply. | Any substantial reply (a table, a PRD written inline) is a document. | **a)**, with an operation *Make into a document* on a reply. Otherwise every long answer gains versions and exports nobody asked for (§4.3.2: each concept multiplies). |
| 3 | **Refining** | Refining makes a new **version** of the same document; earlier versions stay. | Refining makes a new document. | **a)**. It matches the prototype and PRD P3, and "send the latest one" is a common task that (b) makes hard. |
| 4 | **Document and file** | One concept, **document**. PDF and Word are formats you *export* it as; the file is the result (source/result relationship). | **File** is its own object, with its own identity, alongside the document. | **a)**. Users talk about "the invoice", not "the .docx". (b) is what produced the View/Download confusion. |
| 5 | **Missing facts** | **Missing** is a value a fact can have, shown on the document where the fact belongs, and listed. | Missing facts are mentioned in the reply text only. | **a)**. This is the PRD §3 trouble report: prose lists of missing facts failed. |
| 6 | **Style** | A document's **look** (brand, type, colour, page size) is a user concept: it can be seen, named and changed ("use our brand", "make it A4"). | Look is a hidden default the user never manipulates. | **Open; leaning a)**. Tonight's run shows the look drifting between documents (accents, margins, 9 pt body text), and S4's design.md assumes (a). But (a) adds a concept. A narrowing candidate. |

**Also needed from Chai:** the P2 FigJam map (or "superseded"), and the user's own word for the made thing. Is it a *document*, a *doc*, a *file*, or the type name ("the invoice")?

---

*Author: Claude (drafter) for Chai. Date: 2026-10-16. Version 0.0 (Round 1).*
