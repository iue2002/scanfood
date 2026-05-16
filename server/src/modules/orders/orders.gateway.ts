import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import * as http from 'http';

@Injectable()
export class OrdersGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersGateway.name);
  private wss: Server;
  // 支持多客户端订阅同一桌台：Map<tableId, Set<WebSocket>>
  private tableClients: Map<string, Set<WebSocket>> = new Map();
  // 支持多客户端订阅同一订单：Map<orderId, Set<WebSocket>>
  private orderClients: Map<string, Set<WebSocket>> = new Map();
  private adminClients: Set<WebSocket> = new Set();

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

    this.wss.on('connection', (ws: WebSocket) => {
      this.logger.log('Client connected');

      ws.on('message', (data: string) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (err) {
          this.logger.error('Failed to parse message', err);
        }
      });

      ws.on('error', (err) => {
        this.logger.error('WebSocket client error', err.message);
      });

      ws.on('close', () => {
        this.logger.log('Client disconnected');
        // 从所有桌台订阅中移除
        for (const [key, clients] of this.tableClients.entries()) {
          if (clients.has(ws)) {
            clients.delete(ws);
            if (clients.size === 0) {
              this.tableClients.delete(key);
            }
          }
        }
        // 从所有订单订阅中移除
        for (const [key, clients] of this.orderClients.entries()) {
          if (clients.has(ws)) {
            clients.delete(ws);
            if (clients.size === 0) {
              this.orderClients.delete(key);
            }
          }
        }
        this.adminClients.delete(ws);
      });
    });

    this.logger.log('WebSocket server initialized');
  }

  private handleMessage(client: WebSocket, message: any) {
    const { event, data } = message;

    switch (event) {
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
    this.adminClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (err) {
          this.logger.error('Failed to send message to admin client', err.message);
          this.adminClients.delete(client);
        }
      }
    });
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
}
