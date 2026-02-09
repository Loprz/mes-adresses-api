import { Module } from '@nestjs/common';
import { OvertureModule as SharedOvertureModule } from '@/shared/modules/overture/overture.module';
import { OvertureController } from './overture.controller';

@Module({
  imports: [SharedOvertureModule],
  controllers: [OvertureController],
})
export class OvertureApiModule {}
