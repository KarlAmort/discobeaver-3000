# Hierarchical video segmentation

## Finding

The remembered algorithm exists in close form: Eisenstein's hierarchical segmentation uses dynamic programming to find a globally optimal nested partition for fixed interval scores, but its published complexity is `O(LT³)` time and `O(LT²)` state for `L` hierarchy levels and `T` temporal units, not `O(dˢ)`. Under conventional notation `O(dˢ)` is exponential in `s`. Source: [Eisenstein, “Hierarchical Text Segmentation from Multi-Scale Lexical Cohesion,” §3.2](https://aclanthology.org/N09-1040.pdf).

The model's lexical likelihood can be replaced by an interval score derived from video, audio, transcript, or fused observations; that adaptation is a proposal, not a claim made by Eisenstein.

The practical first implementation should compare an exact minimum-description-length flat segmenter, adjacency-constrained Ward clustering for a complete ordered tree, and Eisenstein's nested dynamic program. A hierarchy is useful only if it beats flat and every-cut baselines under source-blind evaluation.

## Algorithms

### Nested dynamic program

Eisenstein's recurrence combines a split at `t`, the child-level score for `[t,v]`, and the current-level prefix score: `Aˡ[u,v] = maxₜ {Bˡ[t,v] + Aˡ⁻¹[t,v] + Aˡ[u,t]}`. It guarantees nesting when the interval scores and number of levels are fixed. Source: [paper, equation 6 and complexity discussion](https://aclanthology.org/N09-1040.pdf).

Use this when ACT/SCENE depth is fixed or selected by an outer model-selection criterion. Bound the maximum interval span or prune candidate boundaries to make long films tractable.

### Minimum-description-length segmentation

MDLSeg chooses a partition whose encoded feature residuals plus model description are shortest and solves the minimization exactly by dynamic programming. Its evidence is feature-agnostic and parameter-free after frame features are chosen. Source: [“Parameter-Free Video Segmentation for Vision,” MDLSeg method](https://openreview.net/pdf?id=uh6aDR1jlw).

The published flat partition is not itself a nested hierarchy. Run it as a baseline and as a proposal generator; do not treat independently fitted segment counts as nested.

### Kernel temporal segmentation

KTS minimizes within-segment kernel variance with `L[q,j] = minₜ L[q−1,t] + v(t,j)`, requiring roughly `O(mₘₐₓT²)` optimization after kernel construction. It is an exact flat-partition baseline, but partitions fitted for different segment counts need not nest. Source: [Potapov et al., “Category-Specific Video Summarization,” KTS §3](https://www.cv-foundation.org/openaccess/content_eccv_2014/papers/Danila_Potapov_Category-specific_video_summarization_2014_ECCV_paper.pdf).

### Ordered agglomeration

Adjacency-constrained Ward clustering repeatedly merges adjacent intervals with minimum increase `Δ(A,B) = |A||B|‖μA−μB‖²/(|A|+|B|)`. It creates a complete ordered dendrogram and therefore every possible display depth, but it is greedy rather than globally optimal.

Use Ward as the fast hierarchy baseline: quadratic without locality limits, or approximately `O(T(h+log T))` bookkeeping with a maximum neighborhood/span `h`. The locality-bounded complexity is an implementation proposal.

### Hierarchical aligned clustering

HACA jointly aligns and hierarchically clusters human-motion sequences. The joint problem is NP-hard; dynamic programming appears inside coordinate descent rather than making the whole method globally optimal. Source: [Zhou, De la Torre, and Hodgins, “Hierarchical Aligned Cluster Analysis”](https://www.ri.cmu.edu/publications/hierarchical-aligned-cluster-analysis-for-temporal-clustering-of-human-motion/).

### Smoothed novelty

Chasanis, Likas, and Galatsanos build shot visual-word features, smooth at two temporal scales, and select local maxima as scenes and chapters. This is a directly relevant movie heuristic, not a nested dynamic program. Source: [“Scene Detection in Videos Using Shot Clustering and Sequence Alignment,” IEEE TMM 2009](https://doi.org/10.1109/TMM.2009.2017630).

## Depth signal

The canonical object is a discrete interval tree. A one-dimensional ultrametric contour map records each boundary's merge height; cutting the contour at any height produces a nested partition. Source: [Arbeláez et al., “Contour Detection and Hierarchical Image Segmentation,” ultrametric contour maps](https://people.eecs.berkeley.edu/~malik/papers/arbelaezMFM-pami2010.pdf).

For the requested signed display, assign an interval at tree depth `k` the value `−k`. At a sibling boundary, rise to the negative depth of the siblings' lowest common ancestor, then descend into the next interval: outside `0`, ACT `−1`, SCENE `−2`, ACT boundary `0`, and intra-ACT SCENE boundary `−1`.

The tree and boundary heights are exact; the continuous curve is only a visualization. Give each rise a narrow width proportional to timestamp uncertainty, or draw repeated x-coordinates for a zero-width step. Color can independently encode the interval's median Lab color, while line height continues to encode structural depth.

## Evidence

The target variable is a boundary at one or more hierarchy levels. Measure each modality by held-out boundary log-loss or minimum-description-length bits saved over a duration, position, genre, and format baseline, then report lift per joule, decoded byte, wall-second, and persisted byte.

Conditional information `I(B;X | shot cut, position, format, genre)`, ablation, and permutation tests prevent a high-entropy stream from being mistaken for useful structural evidence.

- Container chapters and subtitle inventories are cheapest and most explicit; accept them in production but withhold them from blind chapter-prediction evaluation.
- Subtitle text, speaker turns, and lexical embeddings are usually the cheapest semantic observations.
- Sparse Lab/HSV histograms, Vision feature prints, shot cuts, motion, and composition changes provide visual novelty; refine densely only near candidates.
- Mono low-rate RMS, silence, spectral flux, MFCC, and log-mel novelty provide inexpensive audio structure before sound classification.
- ASR is a fallback when a usable original-language subtitle track is absent; diarization requires voice activity, embeddings, and clustering because Apple exposes no general named-speaker API.
- Faces, people, places, objects, actions, poses, and situations can add semantic persistence, but classification is not identity and action inference is an expensive late-stage pass.
- Local seek and replay behavior identifies personal salience, not necessarily a narrative boundary; never use it as source truth.

## Demand order

1. Read duration, tracks, chapters, subtitles, edit/timestamp maps, keyframes, and byte/sample tables without decoding media.
2. Record local playback, seeks, revisits, and explicit user chapter edits on-device.
3. Decode sparse thumbnails and a mono audio envelope, then compute color, image, silence, and novelty curves.
4. Densely refine uncertain candidate windows rather than decoding the whole film again.
5. Run subtitle semantics and speaker-turn analysis, then ASR only when subtitles are missing.
6. Run faces, objects, places, pose, optical flow, and custom action models only while idle, powered, thermally safe, or explicitly requested.

On Apple platforms, relevant building blocks include [AVAsset chapter metadata](https://developer.apple.com/documentation/avfoundation/avasset/loadchaptermetadatagroups%28withtitlelocale:containingitemswithcommonkeys:%29), [Vision feature-print similarity](https://developer.apple.com/documentation/vision/analyzing-image-similarity-with-feature-print), [Sound Analysis](https://developer.apple.com/documentation/soundanalysis), [SpeechAnalyzer](https://developer.apple.com/documentation/speech/speechanalyzer), and [Vision image classification](https://developer.apple.com/documentation/vision/classifying-images-for-categorization-and-search).

## Formats

MP4 and QuickTime can expose chapter references, timed metadata, edit lists, sample timing, sample sizes, sync samples, and dependency flags. Remote files may put `moov` at the tail, so a metadata probe may need both head and tail range requests. These formats normally express a flat chapter list.

Matroska has recursive `ChapterAtom` elements and therefore can already carry the requested hierarchy. `SeekHead` can make front-loaded chapter discovery cheap; `Cues` optimize seeking but are not semantic scenes. Source: [RFC 9559 §§5.1.7 and 20.2.3](https://www.rfc-editor.org/rfc/rfc9559.html#section-20.2.3).

HLS discontinuities, date ranges, I-frame playlists, and rendition boundaries can generate candidates but usually describe delivery or encoding events. DASH Period, EventStream, and `emsg` similarly represent program or timed events, not a universal scene hierarchy.

Browser `textTracks` can expose WebVTT chapter cues. WebCodecs receives demuxed chunks rather than parsing containers; CORS, Media Source blobs, encrypted media, and DRM can prevent byte or decoded-frame access even when playback works.

Compression is weak evidence, not ground truth: keyframes, sample sizes, reference dependencies, encoder scene cuts, and bitrate changes sometimes correlate with novelty, but fixed GOPs, adaptive streaming switches, overlays, and encoder policy often dominate. Timestamp all observations on presentation time, not file order.

The bottleneck changes by stage: remote metadata is latency and range-I/O bound; sparse decode is often hardware-decoder throughput bound; optical flow, embeddings, ASR, and semantic fusion are CPU/GPU/Neural Engine bound; encrypted playback may be access-bound.

## YouTube

Manual YouTube chapters are useful flat held-out targets. A separate curator must reject title cards, slates, interstitial chapter screens, automatic chapters, sponsor cards, and descriptions whose timestamps leak into the predictor. The predictor must not receive chapter titles, descriptions, seek thumbnails, comments, or replay graphs.

VidChapters-7M reports 817,076 videos and 6,813,732 user-annotated chapters after excluding automatically generated chapters; split by channel to reduce creator leakage. Source: [VidChapters-7M dataset paper](https://papers.neurips.cc/paper_files/paper/2023/file/9b5c3e00d6ed30aad7adac9e7a664de1-Paper-Datasets_and_Benchmarks.pdf).

YouTube documents the viewer-facing Most replayed graph, but the public Videos API documents no replay-density property. Do not depend on private page payloads. Sources: [YouTube Help](https://support.google.com/youtube/answer/12825599) and [Videos API resource](https://developers.google.com/youtube/v3/docs/videos).

Build a local replay curve in one-second bins: accumulate watched seconds `Eᵢ`, visits `Vᵢ`, and directed seek pairs; compute replay excess `Rᵢ = max(0,Eᵢ−Uᵢ)` over unique exposure `Uᵢ`; weight backward seeks that lead to dwell; smooth with a short kernel; shrink bins toward zero when observation counts are small; retain only on-device aggregates unless a user explicitly exports them.

## Evaluation

Reveal the literary source only after predictions are persisted. OpenLibrary owns immutable edition provenance and ACT/SCENE extraction; this project owns rendition metadata, transcript alignment, predictions, and scores.

Normalize Unicode, case, punctuation, and speaker labels only for matching while preserving literal source and transcript spans. Align monotonically with affine gaps, allow constrained reordering only inside a bracketed scene, and exclude absent, crossed, or unresolved passages from boundary truth rather than inventing point timestamps.

Score ACT and SCENE boundaries independently with one-to-one dynamic-programming matching at 500 ms and 3 s tolerances; report precision, recall, F1, median deviation, false boundaries, missed boundaries, macro average, and micro average. WindowDiff and hierarchical edit metrics are secondary diagnostics.

Required negative controls are no boundaries, every shot, uniform spacing, ACT/SCENE level swap, wrong source, shuffled hierarchy, tolerance-edge cases, and omitted, inserted, or reordered rendition passages.

The executable boundary scorer and deterministic controls are in [`score.js`](../app/javascript/video/scenes/score.js) and [`score.test.mjs`](../test/javascript/scenes/score.test.mjs).
