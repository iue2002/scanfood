import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Server, WebSocket } from 'ws';
import * as http from 'http';

@Injectable()
export class OrdersGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersGateway.name);
  private wss: Server;
  private tableClients: Map<string, WebSocket> = new Map();
  private orderClients: Map<string, WebSocket> = new Map();
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

      ws.on('close', () => {
        this.logger.log('Client disconnected');
        for (const [key, socket] of this.tableClients.entries()) {
          if (socket === ws) {
            this.tableClients.delete(key);
            break;
          }
        }
        for (const [key, socket] of this.orderClients.entries()) {
          if (socket === ws) {
            this.orderClients.delete(key);
            break;
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
    this.tableClients.set(String(tableId), client);
    this.logger.log(`Client subscribed to table: ${tableId}`);

    client.send(JSON.stringify({
      event: 'subscribed',
      data: { tableId }
    }));
  }

  private handleUnsubscribeTable(client: WebSocket, data: { tableId: string }) {
    const { tableId } = data;
    this.tableClients.delete(String(tableId));
    this.logger.log(`Client unsubscribed from table: ${tableId}`);

    client.send(JSON.stringify({
      event: 'unsubscribed',
      data: { tableId }
    }));
  }

  private handleSubscribeOrder(client: WebSocket, data: { orderId: string }) {
    const { orderId } = data;
    this.orderClients.set(String(orderId), client);
    this.logger.log(`Client subscribed to order: ${orderId}`);

    client.send(JSON.stringify({
      event: 'subscribed',
      data: { orderId }
    }));
  }

  private handleUnsubscribeOrder(client: WebSocket, data: { orderId: string }) {
    const { orderId } = data;
    this.orderClients.delete(String(orderId));
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
        client.send(message);
      }
    });
  }

  notifyTableUpdate(tableId: string | number, data: any) {
    const client = this.tableClients.get(String(tableId));
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        event: 'orderUpdated',
        data,
      }));
      this.logger.log(`Notified table ${tableId} of order update`);
    }
  }

  notifyOrderStatusChange(tableId: string | number, order: any) {
    const client = this.tableClients.get(String(tableId));
    if (client && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        event: 'orderStatusChanged',
        data: order,
      }));
      this.logger.log(`Notified table ${tableId} of order status change`);
    }

    // 也通知订阅了该订单的客户端
    const orderClient = this.orderClients.get(String(order.id));
    if (orderClient && orderClient.readyState === WebSocket.OPEN) {
      orderClient.send(JSON.stringify({
        event: 'orderStatusChanged',
        data: order,
      }));
      this.logger.log(`Notified order ${order.id} of status change`);
    }
  }
}
