import { Module } from '@nestjs/common';
import { UploadController } from './upload.controller';
import { TinifyService } from './tinify.service';

@Module({
  controllers: [UploadController],
  providers: [TinifyService],
})
export class UploadModule {}