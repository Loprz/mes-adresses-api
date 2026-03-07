import { Module, MiddlewareConsumer, forwardRef, Logger } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

import { Habilitation } from '@/shared/entities/habilitation.entity';

import { HabilitationController } from './habilitation.controller';
import { BaseLocaleMiddleware } from '@/modules/base_locale/base_locale.middleware';
import { HabilitationService } from './habilitation.service';
import { BaseLocaleModule } from '../../base_locale.module';
import { PublicationModule } from '@/shared/modules/publication/publication.module';
import { TransactionalEmailService } from '@/shared/modules/transactional_email/transactional_email.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Habilitation]),
    forwardRef(() => BaseLocaleModule),
    PublicationModule,
  ],
  providers: [
    HabilitationService,
    BaseLocaleMiddleware,
    TransactionalEmailService,
    Logger,
  ],
  controllers: [HabilitationController],
  exports: [HabilitationService],
})
export class HabilitationModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(BaseLocaleMiddleware).forRoutes(HabilitationController);
  }
}
