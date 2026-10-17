# Spec catalog

One line per spec type. Foundation (`S`) and Quality (`Q`) live in SKILL.md. Dropped on purpose: SRE03, SRE05, AN02, AN03. Select with the rule table in SKILL.md.

## Tier 2: UI/UX
- U01 UI Layout: pages, components, responsive behavior
- U02 UI Flows: user journeys and state transitions
- U03 UI Components: buttons, forms, modals, cards
- U04 UI Animations: transitions and micro-interactions
- U05 UI Accessibility: ARIA, keyboard navigation, screen readers
- U06 UI Error States: validation, messages, recovery

## Tier 3: API
- A01 API Overview: endpoints, versioning, conventions
- A02 API Authentication: auth flows, token handling
- A03 API Resources: operations per resource
- A04 API Errors: codes, messages, recovery
- A05 API Rate Limiting: throttling, quotas, backoff
- A06 API Webhooks: events, payloads, retries

## Tier 4: Data
- D01 Database Schema: tables, constraints, indexes
- D02 Database Queries: query patterns, optimization
- D03 Database Migrations: upgrade paths, rollback
- D04 Data Validation: input validation, sanitization
- D05 Data Retention: archival, deletion, compliance

## Tier 5: Business logic
- B01 Business Rules: invariants, constraints
- B02 State Machines: states, transitions, guards
- B03 Workflows: multi-step processes
- B04 Calculations: formulas, rounding
- B05 Notifications: email, push, in-app

## Tier 6: Cross-cutting
- X01 Security: authorization, encryption, known risks
- X02 Logging: events, levels, formats
- X03 Monitoring: metrics, alerts (observability pack)
- X04 Error Handling: global handling and recovery
- X05 Configuration: env vars, flags, secrets

## Tier 7: Operations
- O01 Deployment: CI/CD, environments, rollback
- O02 Infrastructure: compute, containers, networking
- O03 Performance: targets and load-test method
- O04 Backup and Recovery: backups, disaster recovery
- O05 Runbooks: incident and maintenance procedures

## Tier 9: Integration
- I01 Third-Party Integrations: external contracts and failure modes
- I02 API Versioning: strategy, deprecation
- I03 Feature Flags: rollout, kill switches
- I04 Webhook Receivers: inbound webhooks, verification
- I05 Event Schema Registry: event schemas, versioning

## Tier 10: Mobile
- M01 Mobile Overview: platform specifics
- M02 Mobile Navigation: screen flows, gestures
- M03 Mobile Components: native UI components
- M04 Mobile Offline: sync, conflict resolution
- M05 Push Notifications: delivery handling

## Tier 11: AI/ML
- AI01 Model Cards: purpose, limits, biases
- AI02 Training Pipelines: ingestion, preprocessing
- AI03 Model Serving: inference endpoints, versioning
- AI04 Feature Engineering: feature definitions
- AI05 Model Monitoring: drift, retraining triggers

## Tier 12: SRE
- SRE01 SLIs/SLOs: service level definitions
- SRE02 Incident Management: response procedures
- SRE04 Chaos Engineering: failure injection (opt-in)

## Tier 13: Localization
- L01 Locale Support: locales, fallback chains
- L02 String Management: keys, placeholders
- L03 Cultural Adaptation: formats, RTL
- L04 Content Localization: images, colors, content

## Tier 14: Data engineering
- DE01 Data Pipelines: ETL/ELT workflows
- DE02 Data Quality: validation, cleansing
- DE03 Data Lineage: sources, impact analysis
- DE04 Data Governance: catalog, ownership
- DE05 Caching Strategy: levels, invalidation, TTL

## Tier 15: Realtime
- RT01 WebSocket Connections: lifecycle, auth
- RT02 Real-Time Events: types, subscriptions
- RT03 Presence and Status: online state, typing
- RT04 Collaboration: concurrent editing, conflicts

## Tier 16: Analytics
- AN01 Event Tracking: events and metric definitions
- AN04 Dashboards: visualization and alerts (only on request)

## Tier 17: Security enhanced
- SEC01 Threat Modeling: attack surfaces, STRIDE
- SEC02 Secrets Management: storage, rotation, scope
- SEC03 Compliance Mapping: named regimes only
- SEC04 Audit Trail: immutable logs, retention
