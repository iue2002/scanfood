import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CaptchaService } from './captcha.service';
import { JwtStrategy } from './jwt.strategy';
import { LoginRateLimitMiddleware, RegisterRateLimitMiddleware } from './login-rate-limit.middleware';
import { getJwtSecret } from './jwt-secret';

@Module({
  imports: [
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, CaptchaService, JwtStrategy],
  exports: [AuthService, CaptchaService, JwtModule],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoginRateLimitMiddleware).forRoutes('auth/login');
    consumer.apply(RegisterRateLimitMiddleware).forRoutes('auth/register');
  }
}
