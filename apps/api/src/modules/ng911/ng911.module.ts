import { Module } from '@nestjs/common';
import { Ng911Module as SharedNg911Module } from '@/shared/modules/ng911/ng911.module';
import { Ng911Controller } from './ng911.controller';

@Module({
  imports: [SharedNg911Module],
  controllers: [Ng911Controller],
})
export class Ng911ApiModule {}
