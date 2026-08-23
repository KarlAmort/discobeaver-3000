# Source and rendition corpus

## Contract

Each case retains `schema`, `pair`, `source`, `rendition`, `alignment`, `reference`, and `prediction`. Every source node retains identifier, parent, kind, ordinal, locator, literal span, and source-stated start/end; every transcript cue retains literal text and start/end.

Rights, fidelity, availability, hierarchy quality, and title-card leakage are separate fields. “Usable” is reversible and never replaces the underlying datum or locator.

## Requested cases

### Cyrano de Bergerac

- Source: Edmond Rostand, five-act play, [Open Library edition OL6554978M](https://openlibrary.org/books/OL6554978M) and its linked scan.
- Rendition: Michael Gordon's 1950 film, [Internet Archive item `cyrano-de-bergerac-1950-by-michael-gordon`](https://archive.org/details/cyrano-de-bergerac-1950-by-michael-gordon).
- Source-stated relation: the source supplies ACT hierarchy and dialogue; the rendition retains substantial dialogue and dramatic order.
- Inference requiring verification: scene-level fidelity and omissions must be established by transcript alignment before evaluation.
- Rights: source and linked film are presented as public-domain materials by their repositories; retain repository rights statements with any acquired file.
- Usability: strongest initial dialogue-heavy film pair; title-card leakage must be checked before admission.
- OpenLibrary request: pending [`24895`](https://3000.amort.berlin/openlibrary), requester `discobeaver-3000`.

### Hamlet

- Source: William Shakespeare, five-act play, [Open Library edition OL6603708M](https://openlibrary.org/books/OL6603708M); source hierarchy has scenes per act 5, 2, 4, 7, and 2.
- Rendition: 1913 silent staging associated with Drury Lane, [Internet Archive item `silent-hamlet`](https://archive.org/details/silent-hamlet).
- Source-stated relation: the item identifies Hamlet and a staged rendition.
- Inference requiring verification: a silent adaptation may align action and intertitles rather than spoken lines; the 20-scene oracle needs shot/intertitle alignment.
- Rights: public-domain source and historical film candidate; retain item-specific rights metadata.
- Usability: valuable cross-modal stress test, but intertitles may leak scene structure and therefore require a separate no-title-card judgment.
- OpenLibrary request: pending [`24896`](https://3000.amort.berlin/openlibrary), requester `discobeaver-3000`.

### Peter Pan

- Source: J. M. Barrie's play, [Open Library edition OL58982551M](https://openlibrary.org/books/OL58982551M).
- Rendition: Herbert Brenon's 1924 film, [Internet Archive item `peter-pan-1924-by-herbert-brenon`](https://archive.org/details/peter-pan-1924-by-herbert-brenon).
- Source-stated relation: the item identifies the work and adaptation.
- Inference requiring verification: edition-to-film scene fidelity is weaker than Cyrano and must be aligned rather than assumed.
- Rights: source and film are historical public-domain candidates; retain repository rights metadata.
- Usability: secondary generalization case; reject if intertitles or inserted cards make boundaries trivial.
- OpenLibrary request: pending [`24897`](https://3000.amort.berlin/openlibrary), requester `discobeaver-3000`.

### Il barbiere di Siviglia

- Source: Cesare Sterbini's two-act libretto, [Open Library edition OL49203277M](https://openlibrary.org/books/OL49203277M), [Internet Archive scan `ilbarbieredisivi00ster_10`](https://archive.org/details/ilbarbieredisivi00ster_10), with source scene counts 16 and 11.
- Rendition: Paris Opera production, locator supplied by the official stream identifier `mE1qMqik`, duration reported as 9,249 seconds, act starts reported as 00:00:01 and 01:38:18.
- Source-stated relation: the publisher identifies the opera, production, language, and act timestamps.
- Inference requiring verification: scene fidelity requires subtitle or libretto alignment; identity and act timestamps alone do not establish it.
- Rights: libretto is public domain; official performance video is paid or access-controlled and is not redistributable as a fixture.
- Usability: metadata-only external evaluation unless the owner has authorized playback access; no video bytes enter the corpus.
- OpenLibrary request: pending [`24898`](https://3000.amort.berlin/openlibrary), requester `discobeaver-3000`.

## Additional candidates

### Così fan tutte

- Source: Lorenzo Da Ponte's two-act libretto, [Wikidata Q207410](https://www.wikidata.org/wiki/Q207410) and [Internet Archive scan `bub_gb_orr5ovL7vwEC`](https://archive.org/details/bub_gb_orr5ovL7vwEC), with reported scene counts 16 and 18.
- Rendition: Paris Opera official stream identifier `HwiK8pjp`, duration reported as 10,957 seconds, act starts reported as 00:00:01 and 01:29:05.
- Fidelity: identity, language, and act times are publisher-stated; scene fidelity remains an alignment hypothesis.
- Rights: public-domain text and nonredistributable performance stream.
- Usability: authorized-playback evaluation only; inspect for inserted act cards independently.

### Rigoletto

- Source: Francesco Maria Piave's three-act libretto, [Wikidata Q189234](https://www.wikidata.org/wiki/Q189234) and [Internet Archive scan `rigolettomelodra00piav`](https://archive.org/details/rigolettomelodra00piav), with reported scene counts 15, 8, and 9.
- Rendition: Paris Opera official stream identifier `JCLxr03V`, duration reported as 8,434 seconds, act starts reported as 00:00:01, 01:02:55, and 01:36:45.
- Fidelity: identity and act times are publisher-stated; scene fidelity remains an alignment hypothesis.
- Rights: public-domain text and nonredistributable performance stream.
- Usability: authorized-playback evaluation only; inspect for inserted act cards independently.

### Carmen

- Source: Henri Meilhac and Ludovic Halévy's four-act libretto, [Wikidata Q185968](https://www.wikidata.org/wiki/Q185968) and [Internet Archive scan `carmenopracomi00bize`](https://archive.org/details/carmenopracomi00bize), with reported scene counts 11, 6, 6, and 2.
- Rendition: Paris Opera official stream identifier `IiEfFNPJ`, duration reported as 9,620 seconds, act starts reported as 00:00:01, 00:49:00, 01:30:35, and 02:10:55.
- Fidelity: identity and act times are publisher-stated; scene fidelity remains an alignment hypothesis.
- Rights: public-domain text and nonredistributable performance stream.
- Usability: authorized-playback evaluation only; inspect for inserted act cards independently.

## Rejected and negative cases

- Richard III: [Open Library edition OL7141325M](https://openlibrary.org/books/OL7141325M) and a 1912 film candidate are retained as a deliberately loose-adaptation negative, not faithful gold.
- Hamlet, 1921: retained as a known adaptation candidate but rejected from faithful-gold status because substantial structural adaptation would confound chapter scoring.
- Julius Caesar, 1950: retained as a candidate but rejected until an authoritative, legally usable complete video locator is verified.
- Expired OperaVision streams: retain their bibliographic locators when encountered, but mark video availability false rather than dropping the records.

## YouTube candidates

These records are metadata-verified but visually provisional. No video was downloaded, and none is certified free of title cards within three seconds of a boundary until an authorized local copy receives frame-level review.

### Protein intake

- Video: FoundMyFitness, “Dr. Luc Van Loon: Optimizing Protein Intake & Distribution for Muscle Growth,” [`wPLr0Ws5NWk`](https://www.youtube.com/watch?v=wPLr0Ws5NWk), duration 02:09:30.
- Creator locator: the [FoundMyFitness episode page](https://www.foundmyfitness.com/episodes/luc-van-loon) visibly labels the list CHAPTERS.
- Top-level anchors: 00:00:00 Introduction; 00:01:16 Protein Requirements; 00:29:20 Protein Distribution; 00:51:55 Protein Supplements; 01:15:47 High-Protein Diets; 01:23:45 Resistance Training.
- Protein Requirements subanchors: 00:01:16, 00:02:20, 00:04:15, 00:06:23, 00:06:50, 00:09:07, 00:10:10, 00:10:59, 00:12:39, 00:14:58, 00:16:15, 00:17:02, 00:19:47, 00:20:59, 00:22:45, 00:24:58.
- Protein Distribution subanchors: 00:29:20, 00:30:35, 00:33:05, 00:36:01, 00:39:22, 00:40:02, 00:40:45, 00:42:39, 00:44:41, 00:45:57, 00:47:07, 00:48:57.
- Protein Supplements subanchors: 00:51:55, 00:54:58, 00:56:14, 00:58:44, 00:59:09, 01:00:14, 01:01:47, 01:02:14, 01:04:07, 01:05:15, 01:08:15, 01:10:57, 01:11:47, 01:12:36, 01:14:03.
- High-Protein Diets subanchors: 01:15:47, 01:18:13, 01:19:50.
- Resistance Training subanchors recorded in this gather: 01:23:45, 01:26:25, 01:28:22, 01:30:49, 01:31:51, 01:32:29; the creator page continues with exact labels through 02:07:30.
- Usability: strongest hierarchical candidate and apparently a continuous two-person science interview; both statements remain subject to frame review.

### Digital dentistry

- Video: Digital Dentistry Masterclass, “Smilecloud 3DNA Launch, Personalized Smile Designs & Digital Workflows - with Dr. Florin Cofar,” [`t1IVjmQjmIE`](https://www.youtube.com/watch?v=t1IVjmQjmIE), duration reported as 00:51:55 with cross-platform corroboration at 00:51:54.
- Creator-description anchors: 00:00 Founding your calling as a dentist; 02:11 Designing individual smiles; 09:06 Switching to digital workflows; 22:15 The vision of Smilecloud; 26:20 Introducing Smilecloud 3DNA, where the source literal joins “Introduc” and “ting Smilecloud 3DNA” without a space; 39:26 Synergyzing with CAD-Systems; 41:07 Exciting new Projects and the Future of Dentistry; 48:17 The Power of Curiosity: Driving Innovation in Dentistry.
- Usability: strongest low-leakage studio candidate because no boundary is labeled as an ad or interstitial; visual review remains pending.

### Cloud development

- Video: Code. Deploy. Go Live., “023 | Cloud Dev Trends: Our Wishes & Predictions for 2026!,” [`1pdqnQLL3Uk`](https://www.youtube.com/watch?v=1pdqnQLL3Uk), duration 01:06:41.
- Creator locator: [episode page](https://codedeploygo.live/episodes/023-cloud-dev-trends-our-wishes-predictions-for-2026), audio duration 01:07:00.
- Creator-description anchors: 00:00 Introduction; 08:18 Wishes for 2026; 37:01 Predictions for 2026; 01:00:37 AC's & Julie's Picks.
- Usability: coarse continuous-conversation stress case with no textual sign of interstitials; visual review remains pending.

### Attachment

- Video: Stephanie Rigg | On Attachment, “How Fearful Avoidant Attachment Shows Up in Relationships,” [`IeQOOb09WlE`](https://www.youtube.com/watch?v=IeQOOb09WlE), duration 00:19:46.
- Transcript locator: [official On Attachment transcript](https://www.onattachment.com/on-attachment-podcast/how-fearful-avoidant-attachment-shows-up-in-relationships).
- Creator-description anchors: 00:00 Introduction and Episode Overview; 01:56 Announcements and Upcoming Events; 03:21 Understanding Fearful Avoidant Attachment; 05:04 Challenges in Relationships; 06:37 The Cycle of Idealisation and Devaluation; 09:16 Understanding Fearful Avoidant Attachment; 11:21 The Role of Shame and Secrecy; 12:45 Challenges in Building Emotional Safety; 14:52 Impact of Partner's Attachment Style; 18:23 Concluding Thoughts and Advice.
- Usability: transcript-corroborated semantic shifts in an apparently continuous solo talking-head recording; visual review remains pending.

### Travel secrets

- Video: Travel Secrets The Podcast, “Celia Imrie’s Travel Secrets | Why I NEVER Travel By Plane,” [`s0AkpfHHF0M`](https://www.youtube.com/watch?v=s0AkpfHHF0M), duration 00:38:28.
- Duration locator: [Spotify episode](https://open.spotify.com/episode/3AjEccfBsOcio1ISgaXnif), 00:38:27.
- Creator-description anchors: 00:00 Intro; 03:21 Secret 1: Number 1 travel destination everybody should go to; 06:55 Secret 2: Most unexpected travel experience; 13:13 Secret 3: Most Over or Underrated travel experience; 15:54 Secret 5: Best Food & Drink while travelling; 21:17 Secret 4: Number 1 travel tip; 24:51 Secret 6: Poignant memory from a trip; 32:08 Secret 7: Special travel photograph; 35:43 Outro.
- Usability: repeated Secret labels provide shallow semantic hierarchy, while Intro and Outro create moderate title-card risk.

### YouTube exclusions

- [`J-Naa36SfhU`](https://www.youtube.com/watch?v=J-Naa36SfhU), Iced Coffee Hour, duration 01:58:30: sponsor-mark boundaries at 00:13:36, 00:35:08, 01:10:04, and 01:10:59 create probable visual and advertisement leakage.
- [`Lx4iYrM0Om0`](https://www.youtube.com/watch?v=Lx4iYrM0Om0): reported duration 00:39:00 conflicts with a creator chapter at 00:44:53, so its metadata is invalid or stale.
- [`QvShDma9_CM`](https://www.youtube.com/watch?v=QvShDma9_CM), Ruthie/Coppola part 2: an interior 00:06 boundary immediately follows Intro and therefore likely marks a bumper.
- [`nVFZ2F-vM-g`](https://www.youtube.com/watch?v=nVFZ2F-vM-g), Renée Yoxon: 02:44 Interview follows Intro and therefore likely marks a format or bumper cut.
- Rights and access: every YouTube case contributes public metadata only; analyze pixels or audio only from an owner-supplied or otherwise authorized local copy.

## Admission

A curator who cannot see model predictions records video identity, edition identity, runtime, chapter metadata, title-card and interstitial intervals, rights, playback availability, and alignment confidence.

Exclude a rendition from primary evaluation when title cards or slates directly announce the evaluated boundaries. Preserve it as a leakage test with the card intervals masked by at least three seconds on each side.

The source hierarchy becomes reference time only through literal transcript alignment. A source ACT or SCENE boundary is represented as an interval bracketed by the last confidently aligned cue before it and first confidently aligned cue after it, not as a fabricated exact point.
