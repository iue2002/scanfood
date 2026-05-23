import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { AuthModule } from '@/modules/auth/auth.module';
import { EmployeeController } from './employee/employee.controller';
import { EmployeeCore } from './employee/employee.core';
import { DrizzleEmployeeRepo } from './employee/employee-repo.drizzle';
import { PermissionsGuard } from './auth/permissions.guard';
import { PERMISSION_MATRIX } from './auth/permission-matrix';
import { ALL_AUDIT_ACTIONS } from './auth/rbac.types';

const EMPLOYEE_REPO_TOKEN = 'EmployeeRepoPort';

@Module({
  imports: [AuthModule],
  controllers: [EmployeeController],
  providers: [
    PermissionsGuard,
    {
      provide: EMPLOYEE_REPO_TOKEN,
      useClass: DrizzleEmployeeRepo,
    },
    {
      provide: EmployeeCore,
      useFactory: (repo) => new EmployeeCore(repo),
      inject: [EMPLOYEE_REPO_TOKEN],
    },
  ],
  exports: [EmployeeCore],
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
