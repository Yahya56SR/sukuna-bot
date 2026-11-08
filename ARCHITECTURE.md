# Sukuna Bot - Architecture Documentation

## Overview
This document describes the architectural design and technical decisions for the Sukuna Discord bot project.

## System Architecture

### Core Pattern
Sukuna follows a **modular monolith** architecture, combining the benefits of monolithic applications with modular development practices. Each module operates independently but integrates through well-defined interfaces.

### Architectural Principles

1. **Single Responsibility**: Each module handles one domain of functionality
2. **Dependency Injection**: Core services are injected rather than hardcoded
3. **Event-Driven**: Internal communication uses events and handlers
4. **Database-First**: Data structures drive service design
5. **Guild Isolation**: All features operate independently per guild
6. **Optional External Dependencies**: All external services are optional

## Layered Architecture

### 1. Presentation Layer (Discord)
- **Commands**: Slash commands, context menus, buttons, modals
- **Events**: Gateway event handlers
- **Interactions**: Real-time user interactions
- **Responses**: Consistent formatting and error handling

### 2. Application Layer (Core Services)
- **Configuration Manager**: Environment and database configuration
- **Permission Manager**: Discord permissions and role-based access
- **Command Registry**: Centralized command registration and validation
- **Event Registry**: Event-driven communication
- **Interaction Router**: Request routing and validation

### 3. Service Layer (Business Logic)
- **Moderation Service**: Enforcement and case management
- **Economy Service**: Financial operations and transactions
- **Leveling Service**: XP tracking and progression
- **AI Service**: Provider-agnostic AI integration
- **Music Service**: Lavalink integration and playback control

### 4. Data Access Layer (Database)
- **Repository Pattern**: Database abstraction with Drizzle ORM
- **SQLite Schema**: Normalized database structure with constraints
- **Migration System**: Version-controlled schema changes
- **Transaction Management**: Atomic operations for critical data

### 5. Integration Layer
- **Lavalink Integration**: Music streaming and playback
- **AI Provider Adapters**: Multiple AI service integrations
- **External APIs**: Optional service integrations

## Module Architecture

### Discord Client Manager (`src/core/`)
**Purpose**: Central Discord client setup and management
**Responsibilities**:
- Client configuration and connection management
- Gateway event handling
- Reconnection logic
- Rate limit handling

### Command System (`src/discord/`)  
**Purpose**: Complete Discord command framework
**Structure**:
- **Commands**: Slash commands implementation
- **Context Menus**: User and message context menus
- **Interactions**: Buttons, select menus, modals
- **Autocomplete**: Dynamic command suggestions

### Module-Specific Architectures

#### Moderation Module (`src/modules/moderation/`)
- **Command Layer**: Moderation commands with confirmation
- **Automod Layer**: Real-time message filtering
- **Case Layer**: Punishment records and history
- **Escalation Layer**: Configurable punishment severity

#### AI Module (`src/modules/ai/`)
- **Provider Layer**: Adapter pattern for multiple AI services
- **Conversation Layer**: Context-aware conversation management
- **Personality Layer**: Configurable bot personalities
- **Proactive Layer**: Relevance filtering and activation

#### Music Module (`src/modules/music/`)
- **Playback Layer**: Lavalink integration and control
- **Queue Layer**: Guild-specific music queues
- **Session Layer**: Independent guild sessions
- **Interactive Layer**: Embed-based controls

## Database Architecture

### Schema Design
- **Normalization**: 3NF compliance for data integrity
- **Guild Isolation**: All records scoped by guild ID
- **Indexing**: Strategic indexing for query performance
- **Constraints**: Foreign keys, unique constraints, check constraints

### Schema Organization
```
Users
Guilds
Channels
Roles
Messages (for leveling)
Economy (balances, transactions)
Moderation (cases, warnings)
Leveling (xp, levels, roles)
Tickets
Giveaways
Automation (scheduled jobs)
AI (conversation history)
Music (queues, sessions)
```

### Repository Pattern
- **Base Repository**: Common database operations
- **Module Repositories**: Domain-specific access methods
- **Transaction Support**: Atomic operations for critical data
- **Query Builder**: Type-safe query construction

## Configuration Architecture

### Configuration Sources
1. **Environment Variables**: Secrets and deployment settings
2. **Database Configuration**: Guild-specific settings
3. **File Configuration**: Local development settings
4. **Default Configuration**: Safe application defaults

### Configuration Structure
```
Application Settings
  - General behavior
  - Performance tuning
  - Feature flags

Guild Configuration
  - Module-specific settings
  - Custom personalities
  - Moderation rules
  - Economy parameters

Module Configuration
  - AI provider settings
  - Music node configuration
  - Automation rules
```

## Communication Architecture

### Event System
- **Event Bus**: Centralized event communication
- **Handler Pattern**: Event-to-action mapping
- **Async Processing**: Non-blocking event handling
- **Error Handling**: Event failure recovery

### Command Execution
- **Middleware Pattern**: Pre/post command processing
- **Permission Checks**: Authorization validation
- **Cooldown Management**: Rate limiting
- **Error Handling**: Consistent error responses

## Security Architecture

### Permission Management
- **Discord Permissions**: Direct mapping to Discord roles
- **Custom Roles**: Module-specific administrative roles
- **Hierarchy Checks**: Role-based authorization
- **Input Validation**: SQL injection and XSS prevention

### Data Protection
- **Guild Isolation**: No cross-guild data access
- **Secret Management**: Environment-based secrets
- **Access Logging**: All sensitive operations logged
- **Audit Trails**: Complete operation history

## Performance Architecture

### Caching Strategy
- **Application Cache**: In-memory data caching
- **Database Cache**: Strategic query result caching
- **Response Caching**: Frequently used data
- **Invalidation**: Cache coherence maintenance

### Resource Management
- **Connection Pooling**: Database and external service connections
- **Async Processing**: Non-blocking I/O operations
- **Memory Management**: Garbage collection optimization
- **Rate Limiting**: Prevent abuse and ensure stability

## Extensibility Architecture

### Plugin System
- **Module Architecture**: New modules can be added without core changes
- **API Contracts**: Well-defined interfaces for module integration
- **Registration System**: Dynamic module discovery
- **Configuration Driven**: Module behavior controlled by config

### Future-Proofing
- **Provider Pattern**: Easy addition of new external services
- **Database Migrations**: Schema evolution support
- **Configuration Options**: Feature toggles for new functionality
- **API Versioning**: Backward-compatible API changes

## Error Handling Architecture

### Error Classification
- **User Errors**: Invalid input, permission issues
- **System Errors**: Database failures, external service issues
- **Validation Errors**: Data format and business rule violations

### Error Recovery
- **Graceful Degradation**: Partial functionality during failures
- **Retry Logic**: Transient error recovery
- **Circuit Breakers**: Prevent cascade failures
- **Logging**: Comprehensive error documentation

## Deployment Architecture

### Docker Configuration
- **Multi-Stage Builds**: Optimized image size
- **Configuration Injection**: Environment-based configuration
- **Volume Mounts**: Persistent data storage
- **Health Checks**: Service availability monitoring

### Scalability
- **Stateless Design**: Horizontal scaling capability
- **Load Balancing**: Multiple instances support
- **Database Clustering**: Read replicas for performance
- **Resource Limits**: CPU and memory controls

## Technology Decisions

### Why This Architecture

1. **Modularity**: Allows independent development and testing
2. **Testability**: Each component can be unit tested in isolation
3. **Maintainability**: Clear separation of concerns
4. **Scalability**: Modular architecture supports growth
5. **Reliability**: Fault isolation prevents system-wide failures

### Design Trade-offs

1. **Monolith vs Microservices**: Simpler deployment, but requires careful module boundaries
2. **SQLite vs External DB**: Local deployment simplicity, but limited scalability
3. **Sync vs Async**: Event-driven architecture for responsiveness
4. **Type Safety**: Full TypeScript compilation for developer experience

## Architectural Decisions Log

See `DECISIONS.md` for detailed technical decisions and their rationale.