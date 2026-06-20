# Canonical Sources

이 파일은 canonical mapping만 관리한다. 제품 요구사항, 아키텍처 결정, 데이터 계약, UI 규칙, 구현 계획의 상세 내용은 이 파일에 중복 기록하지 않는다.

Repository-wide agent and engineering instructions remain in `AGENTS.md`. Topic-specific canonical documents listed below govern their mapped topics.

## Topic Mapping

| Topic | Canonical document | Status | Authority boundary |
| --- | --- | --- | --- |
| product scope | `docs/product-scope.md` | active | Product goal, MVP boundaries, user flows, completion criteria |
| architecture | `docs/architecture.md` | active | Desktop/frontend/backend boundaries, editor adapter rules, module responsibilities |
| data contract | `docs/data-contract.md` | active | App-owned structured data contracts and durable command payload invariants |
| UI behavior | `docs/ui-behavior.md` | active | User workflows, layout behavior, dialogs, interaction rules |
| persistence/file handling | `docs/file-handling.md` | active | File/config location, startup creation, import/open/save behavior |
| third-party license compliance | `docs/license-compliance.md` | active | Dependency license notice scope, generation, distribution, and review rules |
| implementation/manual checks | `docs/manual-checks.md` | active | Non-canonical manual verification procedure, latest check results, residual risks |
| implementation plan | `docs/implementation-plan.md` | planned | Ordered delivery plan, milestones, verification checkpoints |
