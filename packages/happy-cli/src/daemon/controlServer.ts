/**
 * HTTP control server for daemon management
 * Provides endpoints for listing sessions, stopping sessions, and daemon shutdown
 */

import fastify, { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from 'fastify-type-provider-zod';
import { logger } from '@/ui/logger';
import { Metadata } from '@/api/types';
import { TrackedSession } from './types';
import { SpawnSessionOptions, SpawnSessionResult } from '@/modules/common/registerCommonHandlers';
import { VscodeBridge } from './vscodeBridge';

export function startDaemonControlServer({
  getChildren,
  stopSession,
  spawnSession,
  requestShutdown,
  onHappySessionWebhook,
  vscodeBridge
}: {
  getChildren: () => TrackedSession[];
  stopSession: (sessionId: string) => boolean;
  spawnSession: (options: SpawnSessionOptions) => Promise<SpawnSessionResult>;
  requestShutdown: () => void;
  onHappySessionWebhook: (sessionId: string, metadata: Metadata) => void;
  vscodeBridge: VscodeBridge;
}): Promise<{ port: number; stop: () => Promise<void> }> {
  return new Promise((resolve) => {
    const app = fastify({
      logger: false // We use our own logger
    });

    // Set up Zod type provider
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>();

    // Session reports itself after creation
    typed.post('/session-started', {
      schema: {
        body: z.object({
          sessionId: z.string(),
          metadata: z.any() // Metadata type from API
        }),
        response: {
          200: z.object({
            status: z.literal('ok')
          })
        }
      }
    }, async (request) => {
      const { sessionId, metadata } = request.body;

      logger.debug(`[CONTROL SERVER] Session started: ${sessionId}`);
      onHappySessionWebhook(sessionId, metadata);

      return { status: 'ok' as const };
    });

    typed.post('/vscode/register', {
      schema: {
        body: z.object({
          instanceId: z.string(),
          appName: z.string(),
          appVersion: z.string(),
          platform: z.string(),
          pid: z.number(),
          workspaceFolders: z.array(z.string()),
          workspaceFile: z.string().nullable().optional()
        }),
        response: {
          200: z.object({ ok: z.literal(true) })
        }
      }
    }, async (request) => {
      const meta = request.body;
      await vscodeBridge.register(meta);
      logger.debug(`[CONTROL SERVER] VS Code registered: ${meta.instanceId}`);
      return { ok: true as const };
    });

    typed.post('/vscode/heartbeat', {
      schema: {
        body: z.object({ instanceId: z.string() }),
        response: {
          200: z.object({ ok: z.literal(true) }),
          404: z.object({ ok: z.literal(false) })
        }
      }
    }, async (request, reply) => {
      const ok = vscodeBridge.heartbeat(request.body.instanceId);
      if (!ok) {
        reply.code(404);
        return { ok: false as const };
      }
      return { ok: true as const };
    });

    typed.post('/vscode/sessions', {
      schema: {
        body: z.object({
          instanceId: z.string(),
          sessions: z.array(z.object({
            id: z.string(),
            title: z.string(),
            lastMessageDate: z.number(),
            needsInput: z.boolean(),
            source: z.union([z.literal('workspace'), z.literal('empty-window')]),
            workspaceId: z.string().optional(),
            workspaceDir: z.string().optional(),
            displayName: z.string().optional(),
            jsonPath: z.string()
          }))
        }),
        response: {
          200: z.object({ ok: z.literal(true) }),
          404: z.object({ ok: z.literal(false) })
        }
      }
    }, async (request, reply) => {
      const ok = await vscodeBridge.updateSessions(request.body.instanceId, request.body.sessions);
      if (!ok) {
        reply.code(404);
        return { ok: false as const };
      }
      return { ok: true as const };
    });

    typed.post('/vscode/live-history', {
      schema: {
        body: z.object({
          instanceId: z.string(),
          sessionId: z.string(),
          updatedAt: z.number().optional(),
          messages: z.array(z.object({
            id: z.string(),
            role: z.union([z.literal('user'), z.literal('assistant')]),
            text: z.string(),
            timestamp: z.number()
          }))
        }),
        response: {
          200: z.object({ ok: z.literal(true) }),
          404: z.object({ ok: z.literal(false) })
        }
      }
    }, async (request, reply) => {
      const ok = vscodeBridge.updateLiveHistory(
        request.body.instanceId,
        request.body.sessionId,
        request.body.messages,
        request.body.updatedAt
      );
      if (!ok) {
        reply.code(404);
        return { ok: false as const };
      }
      return { ok: true as const };
    });

    typed.get('/vscode/instances', {
      schema: {
        response: {
          200: z.object({
            instances: z.array(z.object({
              instanceId: z.string(),
              appName: z.string(),
              appVersion: z.string(),
              platform: z.string(),
              pid: z.number(),
              workspaceFolders: z.array(z.string()),
              workspaceFile: z.string().nullable().optional(),
              lastSeen: z.number()
            }))
          })
        }
      }
    }, async () => {
      const instances = vscodeBridge.listInstances();
      return { instances };
    });

    typed.get('/vscode/instances/:instanceId/sessions', {
      schema: {
        params: z.object({ instanceId: z.string() }),
        response: {
          200: z.object({ sessions: z.array(z.any()) }),
          404: z.object({ sessions: z.array(z.any()) })
        }
      }
    }, async (request, reply) => {
      if (!vscodeBridge.hasInstance(request.params.instanceId)) {
        reply.code(404);
        return { sessions: [] };
      }
      const sessions = vscodeBridge.listSessions(request.params.instanceId);
      return { sessions };
    });

    typed.get('/vscode/instances/:instanceId/sessions/:sessionId/history', {
      schema: {
        params: z.object({
          instanceId: z.string(),
          sessionId: z.string()
        }),
        querystring: z.object({
          limit: z.coerce.number().int().positive().max(1000).optional()
        }),
        response: {
          200: z.object({
            history: z.any()
          }),
          404: z.object({
            error: z.string()
          })
        }
      }
    }, async (request, reply) => {
      if (!vscodeBridge.hasInstance(request.params.instanceId)) {
        reply.code(404);
        return { error: 'VS Code instance not found' };
      }

      try {
        const history = vscodeBridge.getSessionHistory(
          request.params.instanceId,
          request.params.sessionId,
          request.query.limit
        );
        return { history };
      } catch (error) {
        reply.code(404);
        return {
          error: error instanceof Error ? error.message : 'VS Code session not found'
        };
      }
    });

    typed.post('/vscode/instances/:instanceId/send', {
      schema: {
        params: z.object({ instanceId: z.string() }),
        body: z.object({ sessionId: z.string(), message: z.string() }),
        response: {
          200: z.object({ queued: z.literal(true), commandId: z.string() }),
          404: z.object({ queued: z.literal(false) })
        }
      }
    }, async (request, reply) => {
      const queued = vscodeBridge.queueSendMessage(request.params.instanceId, request.body.sessionId, request.body.message);
      if (!queued) {
        reply.code(404);
        return { queued: false as const };
      }
      return { queued: true as const, commandId: queued.commandId };
    });

    typed.get('/vscode/instances/:instanceId/commands', {
      schema: {
        params: z.object({ instanceId: z.string() }),
        response: {
          200: z.object({ commands: z.array(z.any()) }),
          404: z.object({ commands: z.array(z.any()) })
        }
      }
    }, async (request, reply) => {
      if (!vscodeBridge.hasInstance(request.params.instanceId)) {
        reply.code(404);
        return { commands: [] };
      }
      const commands = vscodeBridge.listCommands(request.params.instanceId);
      return { commands };
    });

    typed.post('/vscode/instances/:instanceId/commands/:commandId/ack', {
      schema: {
        params: z.object({ instanceId: z.string(), commandId: z.string() }),
        body: z.object({ ok: z.boolean() }),
        response: {
          200: z.object({ ok: z.literal(true) }),
          404: z.object({ ok: z.literal(false) })
        }
      }
    }, async (request, reply) => {
      const ok = vscodeBridge.ackCommand(request.params.instanceId, request.params.commandId);
      if (!ok) {
        reply.code(404);
        return { ok: false as const };
      }
      return { ok: true as const };
    });

    // List all tracked sessions
    typed.post('/list', {
      schema: {
        response: {
          200: z.object({
            children: z.array(z.object({
              startedBy: z.string(),
              happySessionId: z.string(),
              pid: z.number()
            }))
          })
        }
      }
    }, async () => {
      const children = getChildren();
      logger.debug(`[CONTROL SERVER] Listing ${children.length} sessions`);
      return { 
        children: children
          .filter(child => child.happySessionId !== undefined)
          .map(child => ({
            startedBy: child.startedBy,
            happySessionId: child.happySessionId!,
            pid: child.pid
          }))
      }
    });

    // Stop specific session
    typed.post('/stop-session', {
      schema: {
        body: z.object({
          sessionId: z.string()
        }),
        response: {
          200: z.object({
            success: z.boolean()
          })
        }
      }
    }, async (request) => {
      const { sessionId } = request.body;

      logger.debug(`[CONTROL SERVER] Stop session request: ${sessionId}`);
      const success = stopSession(sessionId);
      return { success };
    });

    // Spawn new session
    typed.post('/spawn-session', {
      schema: {
        body: z.object({
          directory: z.string(),
          sessionId: z.string().optional()
        }),
        response: {
          200: z.object({
            success: z.boolean(),
            sessionId: z.string().optional(),
            approvedNewDirectoryCreation: z.boolean().optional()
          }),
          409: z.object({
            success: z.boolean(),
            requiresUserApproval: z.boolean().optional(),
            actionRequired: z.string().optional(),
            directory: z.string().optional()
          }),
          500: z.object({
            success: z.boolean(),
            error: z.string().optional()
          })
        }
      }
    }, async (request, reply) => {
      const { directory, sessionId } = request.body;

      logger.debug(`[CONTROL SERVER] Spawn session request: dir=${directory}, sessionId=${sessionId || 'new'}`);
      const result = await spawnSession({ directory, sessionId });

      switch (result.type) {
        case 'success':
          // Check if sessionId exists, if not return error
          if (!result.sessionId) {
            reply.code(500);
            return {
              success: false,
              error: 'Failed to spawn session: no session ID returned'
            };
          }
          return {
            success: true,
            sessionId: result.sessionId,
            approvedNewDirectoryCreation: true
          };
        
        case 'requestToApproveDirectoryCreation':
          reply.code(409); // Conflict - user input needed
          return { 
            success: false,
            requiresUserApproval: true,
            actionRequired: 'CREATE_DIRECTORY',
            directory: result.directory
          };
        
        case 'error':
          reply.code(500);
          return { 
            success: false,
            error: result.errorMessage
          };
      }
    });

    // Stop daemon
    typed.post('/stop', {
      schema: {
        response: {
          200: z.object({
            status: z.string()
          })
        }
      }
    }, async () => {
      logger.debug('[CONTROL SERVER] Stop daemon request received');

      // Give time for response to arrive
      setTimeout(() => {
        logger.debug('[CONTROL SERVER] Triggering daemon shutdown');
        requestShutdown();
      }, 50);

      return { status: 'stopping' };
    });

    app.listen({ port: 0, host: '127.0.0.1' }, (err, address) => {
      if (err) {
        logger.debug('[CONTROL SERVER] Failed to start:', err);
        throw err;
      }

      const port = parseInt(address.split(':').pop()!);
      logger.debug(`[CONTROL SERVER] Started on port ${port}`);

      resolve({
        port,
        stop: async () => {
          logger.debug('[CONTROL SERVER] Stopping server');
          await app.close();
          logger.debug('[CONTROL SERVER] Server stopped');
        }
      });
    });
  });
}
