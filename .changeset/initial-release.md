---
"smart-cicd": minor
---

Initial release with Kubernetes-native agentic build platform

- PodWatcher: observe Pod phase transitions, restart counts, and terminations
- JobWatcher: observe Job phase transitions (Active, Succeeded, Failed)
- EventEmitter + EventSink: normalized RuntimeEvent stream
- Normalizer: convert raw K8s signals to structured RuntimeEvents
- Rule engine, AI supervisor, action engine type definitions
- GitHub Actions CI with typecheck and test
- Changesets-based release workflow
