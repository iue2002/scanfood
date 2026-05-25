import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, WebSocket } from 'ws';
import * as http from 'http';
import * as url from 'url';

// WebSocket 连接限流：同一 IP 每秒最多 2 个连接
const ipConnectionCount = new Map<string, { count: number; resetAt: number }>();

function checkConnectionRate(ip: string): boolean {
  const now = Date.now();
  const entry = ipConnectionCount.get(ip);
  if (!entry || now > entry.resetAt) {
    ipConnectionCount.set(ip, { count: 1, resetAt: now + 1000 });
    return true;
  }
  if (entry.count >= 2) return false;
  entry.count++;
  return true;
}

@Injectable()
export class OrdersGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersGateway.name);
  private wss: Server;
  // 支持多客户端订阅同一桌台：Map<tableId, Set<WebSocket>>
  private tableClients: Map<string, Set<WebSocket>> = new Map();
  // 支持多客户端订阅同一订单：Map<orderId, Set<WebSocket>>
  private orderClients: Map<string, Set<WebSocket>> = new Map();
  private adminClients: Set<WebSocket> = new Set();

  constructor(private readonly jwtService: JwtService) {}

  onModuleInit() {
    // WebSocket 服务器会在 app.listen 后通过 HTTP server 升级
  }

  onModuleDestroy() {
    if (this.wss) {
      this.wss.close();
    }
  }

  init(httpServer: http.Server) {
    this.wss = new Server({ server: httpServer, path: '/ws' });

    // ====== 心跳：服务端每 30 秒对所有 client 发 native ping，30 秒内没收到 pong 就 terminate ======
    // 关键：穿透/反代（nginx / cpolar / cloudflare 等）通常 60s 空闲断连，这里 30s 心跳能保活
    const HEARTBEAT_INTERVAL_MS = 30_000;
    const heartbeatTimer = setInterval(() => {
      this.wss.clients.forEach((ws: any) => {
        if (ws.isAlive === false) {
          // 上一轮没收到 pong → 视为僵尸连接，强制关闭释放资源
          this.logger.debug('terminating dead ws (no pong)');
          return ws.terminate();
        }
        ws.isAlive = false;
        try { ws.ping(); } catch { /* ignore */ }
      });
    }, HEARTBEAT_INTERVAL_MS);
    this.wss.on('close', () => clearInterval(heartbeatTimer));

    this.wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
      // 标记心跳活跃
      (ws as any).isAlive = true;
      ws.on('pong', () => { (ws as any).isAlive = true; });

      // ===== 安全加固: WebSocket 连接鉴权 =====
      // 从查询参数中提取 token 进行 JWT 验证
      const clientIp = req.headers['x-forwarded-for'] as string
        || req.socket.remoteAddress
        || 'unknown';

      // 连接限流
      if (!checkConnectionRate(clientIp)) {
        this.logger.warn(`WebSocket connection rate limit exceeded: ${clientIp}`);
        ws.close(4001, '连接过于频繁');
        return;
      }

      // JWT 验证
      const queryParams = url.parse(req.url || '', true).query;
      const token = queryParams?.token as string;

      if (!token) {
        this.logger.warn(`WebSocket connection rejected (no token): ${clientIp}`);
        ws.close(4001, '缺少认证令牌');
        return;
      }

      try {
        const payload = await this.jwtService.verifyAsync(token);
        (ws as any).userId = payload.userId;
        (ws as any).role = payload.role;
        this.logger.log(`Client authenticated: userId=${payload.userId}, role=${payload.role}`);
      } catch (err) {
        this.logger.warn(`WebSocket auth failed: ${clientIp}, error: ${(err as Error).message}`);
        ws.close(4001, '令牌无效或已过期');
        return;
      }

      ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (err) {
          this.logger.error('Failed to parse message', err);
        }
      });

      ws.on('error', (err) => {
        // 1006是异常关闭状态码，通常是客户端非正常断开（页面刷新、网络中断等）
        // 这属于正常现象，不需要记录为错误
        if (err.message && err.message.includes('1006')) {
          this.logger.debug('WebSocket client disconnected abnormally (code 1006)');
        } else {
          this.logger.warn('WebSocket client error', err.message);
        }
      });

      ws.on('close', (code, reason) => {
        if (code === 1006) {
          this.logger.debug(`Client disconnected abnormally (code 1006)`);
        } else {
          this.logger.log(`Client disconnected (code ${code})`);
        }
        // 从所有桌台订阅中移除
        this.cleanupClient(ws);
      });
    });

    this.logger.log('WebSocket server initialized');
  }

  private cleanupClient(client: WebSocket) {
    // 从所有桌台订阅中移除
    for (const [key, clients] of this.tableClients.entries()) {
      if (clients.has(client)) {
        clients.delete(client);
        if (clients.size === 0) {
          this.tableClients.delete(key);
        }
      }
    }
    // 从所有订单订阅中移除
    for (const [key, clients] of this.orderClients.entries()) {
      if (clients.has(client)) {
        clients.delete(client);
        if (clients.size === 0) {
          this.orderClients.delete(key);
        }
      }
    }
    this.adminClients.delete(client);
  }

  private handleMessage(client: WebSocket, message: any) {
    const { event, data } = message;

    switch (event) {
      case 'ping':
        // 应用层心跳：客户端主动发，立即回 pong（穿透/反代环境保活更稳）
        try { client.send(JSON.stringify({ event: 'pong', data: { ts: Date.now() } })); } catch { /* ignore */ }
        break;
      case 'subscribeTable':
        this.handleSubscribeTable(client, data);
        break;
      case 'unsubscribeTable':
        this.handleUnsubscribeTable(client, data);
        break;
      case 'subscribeOrder':
        this.handleSubscribeOrder(client, data);
        break;
      case 'unsubscribeOrder':
        this.handleUnsubscribeOrder(client, data);
        break;
      case 'subscribeAdmin':
        this.handleSubscribeAdmin(client);
        break;
      default:
        this.logger.warn(`Unknown event: ${event}`);
    }
  }

  private handleSubscribeTable(client: WebSocket, data: { tableId: string }) {
    const { tableId } = data;
    const key = String(tableId);
    let clients = this.tableClients.get(key);
    if (!clients) {
      clients = new Set();
      this.tableClients.set(key, clients);
    }
    clients.add(client);
    this.logger.log(`Client subscribed to table: ${tableId}, total clients: ${clients.size}`);

    client.send(JSON.stringify({
      event: 'subscribed',
      data: { tableId }
    }));
  }

  private handleUnsubscribeTable(client: WebSocket, data: { tableId: string }) {
    const { tableId } = data;
    const key = String(tableId);
    const clients = this.tableClients.get(key);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) {
        this.tableClients.delete(key);
      }
    }
    this.logger.log(`Client unsubscribed from table: ${tableId}`);

    client.send(JSON.stringify({
      event: 'unsubscribed',
      data: { tableId }
    }));
  }

  private handleSubscribeOrder(client: WebSocket, data: { orderId: string }) {
    const { orderId } = data;
    const key = String(orderId);
    let clients = this.orderClients.get(key);
    if (!clients) {
      clients = new Set();
      this.orderClients.set(key, clients);
    }
    clients.add(client);
    this.logger.log(`Client subscribed to order: ${orderId}, total clients: ${clients.size}`);

    client.send(JSON.stringify({
      event: 'subscribed',
      data: { orderId }
    }));
  }

  private handleUnsubscribeOrder(client: WebSocket, data: { orderId: string }) {
    const { orderId } = data;
    const key = String(orderId);
    const clients = this.orderClients.get(key);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) {
        this.orderClients.delete(key);
      }
    }
    this.logger.log(`Client unsubscribed from order: ${orderId}`);

    client.send(JSON.stringify({
      event: 'unsubscribed',
      data: { orderId }
    }));
  }

  private handleSubscribeAdmin(client: WebSocket) {
    this.adminClients.add(client);
    this.logger.log(`Admin client subscribed. Total admin clients: ${this.adminClients.size}`);

    client.send(JSON.stringify({
      event: 'subscribed',
      data: { type: 'admin' }
    }));
  }

  notifyAllAdmins(event: string, data: any) {
    const message = JSON.stringify({ event, data });
    let sentCount = 0;
    let totalAdmins = this.adminClients.size;
    this.adminClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
          sentCount++;
        } catch (err) {
          this.logger.error('Failed to send message to admin client', err.message);
          this.adminClients.delete(client);
        }
      }
    });
    this.logger.log(`[notifyAllAdmins] event=${event} sent=${sentCount}/${totalAdmins}`);
  }

  /**
   * 强制断开某用户的全部 WebSocket 连接
   * 由 merchant-ops 模块调用：当员工被删除/禁用/改密时立即生效
   * Validates: Requirements 5.6
   */
  disconnectUser(userId: number, reason = 'session revoked') {
    let count = 0;
    // 收集所有挂着该 userId 的 ws 实例
    const allClients = new Set<WebSocket>();
    for (const set of this.tableClients.values()) for (const c of set) allClients.add(c);
    for (const set of this.orderClients.values()) for (const c of set) allClients.add(c);
    for (const c of this.adminClients) allClients.add(c);

    for (const client of allClients) {
      if ((client as any).userId === userId) {
        try {
          // 先发一条提示，再 close
          if (client.readyState === WebSocket.OPEN) {
            try {
              client.send(JSON.stringify({ event: 'mop:session-revoked', data: { reason } }));
            } catch {}
            client.close(4002, reason);
          }
          this.cleanupClient(client);
          count++;
        } catch (err) {
          this.logger.warn(`Failed to disconnect ws for userId=${userId}: ${(err as Error).message}`);
        }
      }
    }
    if (count > 0) {
      this.logger.log(`[force-logout] userId=${userId} 已踢出 ${count} 个 ws 连接`);
    }
    return count;
  }

  notifyTableUpdate(tableId: string | number, data: any) {
    const clients = this.tableClients.get(String(tableId));
    if (clients && clients.size > 0) {
      const message = JSON.stringify({
        event: 'orderUpdated',
        data,
      });
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch (err) {
            this.logger.error(`Failed to notify table ${tableId}`, err.message);
            clients.delete(client);
          }
        }
      });
      this.logger.log(`Notified table ${tableId} of order update, ${clients.size} clients`);
    }
  }

  notifyTableCartUpdate(tableId: string | number, data: any) {
    const clients = this.tableClients.get(String(tableId));
    if (clients && clients.size > 0) {
      const message = JSON.stringify({
        event: 'cartUpdated',
        data,
      });
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch (err) {
            this.logger.error(`Failed to notify table ${tableId} cart update`, err.message);
            clients.delete(client);
          }
        }
      });
      this.logger.log(`Notified table ${tableId} of cart update, ${clients.size} clients`);
    }
  }

  notifyOrderUpdate(orderId: string | number, data: any) {
    const clients = this.orderClients.get(String(orderId));
    if (clients && clients.size > 0) {
      const message = JSON.stringify({
        event: 'orderUpdated',
        data,
      });
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch (err) {
            this.logger.error(`Failed to notify order ${orderId}`, err.message);
            clients.delete(client);
          }
        }
      });
      this.logger.log(`Notified order ${orderId} of update, ${clients.size} clients`);
    }
  }

  notifyOrderStatusChange(tableId: string | number, order: any) {
    const clients = this.tableClients.get(String(tableId));
    if (clients && clients.size > 0) {
      const message = JSON.stringify({
        event: 'orderStatusChanged',
        data: order,
      });
      clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch (err) {
            this.logger.error(`Failed to notify table ${tableId}`, err.message);
            clients.delete(client);
          }
        }
      });
      this.logger.log(`Notified table ${tableId} of order status change, ${clients.size} clients`);
    }

    // 也通知订阅了该订单的客户端
    const orderClients = this.orderClients.get(String(order.id));
    if (orderClients && orderClients.size > 0) {
      const message = JSON.stringify({
        event: 'orderStatusChanged',
        data: order,
      });
      orderClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch (err) {
            this.logger.error(`Failed to notify order ${order.id}`, err.message);
            orderClients.delete(client);
          }
        }
      });
      this.logger.log(`Notified order ${order.id} of status change, ${orderClients.size} clients`);
    }
  }

  notifyOrderItemServedChanged(tableId: string | number, order: any, itemMeta: { itemId: number; served: boolean }) {
    const message = JSON.stringify({
      event: 'orderItemServedChanged',
      data: {
        tableId,
        orderId: order.id,
        itemId: itemMeta.itemId,
        served: itemMeta.served,
        order,
      },
    });

    const tableClients = this.tableClients.get(String(tableId));
    if (tableClients && tableClients.size > 0) {
      tableClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch (err) {
            this.logger.error(`Failed to notify table ${tableId} served change`, err.message);
            tableClients.delete(client);
          }
        }
      });
      this.logger.log(`Notified table ${tableId} of served change, ${tableClients.size} clients`);
    }

    const orderClients = this.orderClients.get(String(order.id));
    if (orderClients && orderClients.size > 0) {
      orderClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          try {
            client.send(message);
          } catch (err) {
            this.logger.error(`Failed to notify order ${order.id} served change`, err.message);
            orderClients.delete(client);
          }
        }
      });
      this.logger.log(`Notified order ${order.id} of served change, ${orderClients.size} clients`);
    }

    this.notifyAllAdmins('orderItemServedChanged', {
      tableId,
      orderId: order.id,
      itemId: itemMeta.itemId,
      served: itemMeta.served,
      order,
    });
  }
}
