import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { ImageProcessorService } from './image-processor.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [UploadController],
  providers: [ImageProcessorService],
})
export class UploadModule {}
