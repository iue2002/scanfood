import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '@/modules/auth/auth.module';
import { OrdersModule } from '@/modules/orders/orders.module';
import { OrdersGateway } from '@/modules/orders/orders.gateway';
import { EmployeeController } from './employee/employee.controller';
import { EmployeeCore } from './employee/employee.core';
import { DrizzleEmployeeRepo } from './employee/employee-repo.drizzle';
import { AuditController } from './audit/audit.controller';
import { AuditCore } from './audit/audit.core';
import { DrizzleAuditRepo } from './audit/audit-repo.drizzle';
import { AuditInterceptor } from './audit/audit.interceptor';
import { AuditArchiveScheduler } from './audit/audit-archive.scheduler';
import { NotifPrefController } from './notif-pref/notif-pref.controller';
import { NotifPrefCore } from './notif-pref/notif-pref.core';
import { DrizzleNotifPrefRepo } from './notif-pref/notif-pref-repo.drizzle';
import { BUILTIN_SOUND_CATALOG } from './notif-pref/sound-catalog';
import { ExportController } from './export/export.controller';
import { ExportCore } from './export/export.core';
import { DrizzleExportRepo } from './export/export-repo.drizzle';
import { DrizzleReadOnlyOrdersRepo } from './export/readonly-orders.drizzle';
import { ExcelPdfArtifactAdapter } from './export/export-artifact.adapter';
import { ExportCleanupScheduler } from './export/export-cleanup.scheduler';
import { PrintController } from './print/print.controller';
import { PrintCore } from './print/print.core';
import { DrizzlePrintRepo } from './print/print-repo.drizzle';
import { PrintOrderReader } from './print/readonly-order.drizzle';
import { FeiePrinterDriver } from './print/drivers/feie.driver';
import { BrowserPrinterDriver } from './print/drivers/browser.driver';
import { AesEncryptorService } from './print/aes-encryptor';
import { MopEventBus } from './print/mop-event-bus';
import { PrintScheduler } from './print/print.scheduler';
import { PrintEventHook } from './print/print-event-hook';
import { MerchantOpsRequestLogInterceptor } from './common/request-log.interceptor';
import { RateLimitSweepScheduler } from './common/rate-limit-sweep.scheduler';
import { LocalImageCleanupService } from './common/image-cleanup';
import { StoreSettingsService } from '@/modules/store-settings/store-settings.service';
import { StoreSettingsModule } from '@/modules/store-settings/store-settings.module';
import { PermissionsGuard } from './auth/permissions.guard';
import { PERMISSION_MATRIX } from './auth/permission-matrix';
import { ALL_AUDIT_ACTIONS } from './auth/rbac.types';

const EMPLOYEE_REPO_TOKEN = 'EmployeeRepoPort';
const AUDIT_REPO_TOKEN = 'AuditRepoPort';
const NOTIF_PREF_REPO_TOKEN = 'NotifPrefRepoPort';
const EXPORT_REPO_TOKEN = 'ExportRepoPort';
const READONLY_ORDERS_TOKEN = 'ReadOnlyOrdersPort';
const EXPORT_ARTIFACT_TOKEN = 'ExportArtifactPort';
const PRINT_REPO_TOKEN = 'PrintRepoPort';

@Module({
  imports: [AuthModule, OrdersModule, StoreSettingsModule, ScheduleModule.forRoot()],
  controllers: [EmployeeController, AuditController, NotifPrefController, ExportController, PrintController],
  providers: [
    PermissionsGuard,
    AesEncryptorService,
    FeiePrinterDriver,
    BrowserPrinterDriver,
    MopEventBus,
    PrintOrderReader,
    {
      provide: EMPLOYEE_REPO_TOKEN,
      useClass: DrizzleEmployeeRepo,
    },
    {
      provide: AUDIT_REPO_TOKEN,
      useClass: DrizzleAuditRepo,
    },
    {
      provide: NOTIF_PREF_REPO_TOKEN,
      useClass: DrizzleNotifPrefRepo,
    },
    {
      provide: EXPORT_REPO_TOKEN,
      useClass: DrizzleExportRepo,
    },
    {
      provide: READONLY_ORDERS_TOKEN,
      useClass: DrizzleReadOnlyOrdersRepo,
    },
    {
      provide: EXPORT_ARTIFACT_TOKEN,
      useClass: ExcelPdfArtifactAdapter,
    },
    {
      provide: PRINT_REPO_TOKEN,
      useClass: DrizzlePrintRepo,
    },
    {
      provide: AuditCore,
      useFactory: (repo) => new AuditCore(repo),
      inject: [AUDIT_REPO_TOKEN],
    },
    {
      provide: NotifPrefCore,
      useFactory: (repo) => new NotifPrefCore(repo, BUILTIN_SOUND_CATALOG),
      inject: [NOTIF_PREF_REPO_TOKEN],
    },
    {
      provide: ExportCore,
      useFactory: (repo, ord, art, store: StoreSettingsService) => new ExportCore(
        repo,
        ord,
        art,
        async () => {
          try {
            const s = await store.getStoreSettings();
            return s?.store_name || '伊美轩';
          } catch {
            return '伊美轩';
          }
        },
      ),
      inject: [EXPORT_REPO_TOKEN, READONLY_ORDERS_TOKEN, EXPORT_ARTIFACT_TOKEN, StoreSettingsService],
    },
    {
      provide: PrintCore,
      useFactory: (
        repo,
        feie: FeiePrinterDriver,
        browser: BrowserPrinterDriver,
        aes: AesEncryptorService,
        bus: MopEventBus,
        reader: PrintOrderReader,
      ) => {
        const drivers = new Map<string, any>([
          ['FEIE', feie],
          ['BROWSER', browser],
        ]);
        // BrowserDriver 需要事件总线注入
        try { browser.setEmitter(bus); } catch { /* ignore */ }
        return new PrintCore(
          repo,
          drivers,
          aes.enc,
          bus,
          (orderId: number) => reader.readOrder(orderId),
        );
      },
      inject: [PRINT_REPO_TOKEN, FeiePrinterDriver, BrowserPrinterDriver, AesEncryptorService, MopEventBus, PrintOrderReader],
    },
    {
      provide: EmployeeCore,
      useFactory: (repo, gateway: OrdersGateway, imageCleanup: LocalImageCleanupService) => new EmployeeCore(repo, {
        forceLogout: (userId, reason) => {
          try { gateway.disconnectUser(userId, reason); }
          catch (err) { /* 不让异常冒泡到员工管理主流程 */ }
        },
        cleanupAvatar: (url) => {
          try { void imageCleanup.removeByUrl(url); }
          catch { /* fire-and-forget */ }
        },
      }),
      inject: [EMPLOYEE_REPO_TOKEN, OrdersGateway, LocalImageCleanupService],
    },
    AuditArchiveScheduler,
    ExportCleanupScheduler,
    PrintScheduler,
    PrintEventHook,
    RateLimitSweepScheduler,
    // 全局应用 AuditInterceptor：所有挂 @Audit 装饰器的 controller 自动写日志
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
    // 全局请求日志（仅 /api/merchant-ops/* 路由生效，R20.3）
    {
      provide: APP_INTERCEPTOR,
      useClass: MerchantOpsRequestLogInterceptor,
    },
  ],
  exports: [EmployeeCore, AuditCore, NotifPrefCore, ExportCore, PrintCore],
})
export class MerchantOpsModule implements OnModuleInit {
  private readonly logger = new Logger(MerchantOpsModule.name);

  /**
   * R1.3：启动期校验权限矩阵覆盖了所有声明的 AuditAction
   * （这一波只校验静态 ALL_AUDIT_ACTIONS；真正按路由扫描在 M2）
   */
  onModuleInit() {
    const missing: string[] = [];
    for (const action of ALL_AUDIT_ACTIONS) {
      if (!(action in PERMISSION_MATRIX)) {
        missing.push(action);
      }
    }
    if (missing.length > 0) {
      this.logger.error(
        `[merchant-ops] 权限矩阵缺失以下 AuditAction 条目，请补全：${missing.join(', ')}`,
      );
      throw new Error(`Permission matrix missing entries: ${missing.join(', ')}`);
    }
    this.logger.log(`[merchant-ops] 权限矩阵已校验，覆盖 ${ALL_AUDIT_ACTIONS.length} 个 AuditAction`);
  }
}
