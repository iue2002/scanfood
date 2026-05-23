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
import { PermissionsGuard } from './auth/permissions.guard';
import { PERMISSION_MATRIX } from './auth/permission-matrix';
import { ALL_AUDIT_ACTIONS } from './auth/rbac.types';

const EMPLOYEE_REPO_TOKEN = 'EmployeeRepoPort';
const AUDIT_REPO_TOKEN = 'AuditRepoPort';
const NOTIF_PREF_REPO_TOKEN = 'NotifPrefRepoPort';

@Module({
  imports: [AuthModule, OrdersModule, ScheduleModule.forRoot()],
  controllers: [EmployeeController, AuditController, NotifPrefController],
  providers: [
    PermissionsGuard,
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
      provide: EmployeeCore,
      useFactory: (repo, gateway: OrdersGateway) => new EmployeeCore(repo, {
        forceLogout: (userId, reason) => {
          try { gateway.disconnectUser(userId, reason); }
          catch (err) { /* 不让异常冒泡到员工管理主流程 */ }
        },
      }),
      inject: [EMPLOYEE_REPO_TOKEN, OrdersGateway],
    },
    AuditArchiveScheduler,
    // 全局应用 AuditInterceptor：所有挂 @Audit 装饰器的 controller 自动写日志
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
  exports: [EmployeeCore, AuditCore, NotifPrefCore],
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
