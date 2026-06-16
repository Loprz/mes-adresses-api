import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';

import { BaseLocale } from '@/shared/entities/base_locale.entity';
import { Voie } from '@/shared/entities/voie.entity';
import { Numero } from '@/shared/entities/numero.entity';
import { Toponyme } from '@/shared/entities/toponyme.entity';
import { Position } from '@/shared/entities/position.entity';
import { Cache } from '@/shared/entities/cache.entity';
import { Habilitation } from '@/shared/entities/habilitation.entity';
import { NumeroNg911 } from '@/shared/entities/numero_ng911.entity';

import { NumeroModule } from './modules/numeros/numero.module';
import { BaseLocaleModule } from './modules/base_locale/base_locale.module';
import { VoieModule } from './modules/voie/voie.module';
import { ToponymeModule } from './modules/toponyme/toponyme.module';
import { StatsModule } from './modules/stats/stats.module';
import { MailerModule } from '@nestjs-modules/mailer';
import { MailerParams } from '@/shared/params/mailer.params';
import { AdminModule } from './modules/admin/admin.module';
import { SignalementModule } from './modules/signalement/signalement.module';
import { OvertureApiModule } from './modules/overture/overture.module';
import { Ng911ApiModule } from './modules/ng911/ng911.module';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '../../../'),
      renderPath: 'public/',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get('POSTGRES_URL'),
        keepConnectionAlive: true,
        schema: 'public',
        entities: [BaseLocale, Voie, Numero, Toponyme, Position, Cache, Habilitation, NumeroNg911],
      }),
      inject: [ConfigService],
    }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        let connection: { url: string } | { host: string; port: number; password?: string; username?: string; family: number };
        if (redisUrl?.includes('railway.internal')) {
          try {
            const u = new URL(redisUrl);
            connection = {
              host: u.hostname,
              port: parseInt(u.port || '6379', 10),
              password: u.password || undefined,
              username: u.username || undefined,
              family: 4,
            };
          } catch {
            connection = { url: redisUrl };
          }
        } else {
          connection = { url: redisUrl };
        }
        return {
          connection,
          defaultJobOptions: {
            removeOnComplete: true,
            removeOnFail: true,
          },
        };
      },
      inject: [ConfigService],
    }),
    MailerModule.forRootAsync(MailerParams),
    NumeroModule,
    BaseLocaleModule,
    VoieModule,
    ToponymeModule,
    StatsModule,
    AdminModule,
    SignalementModule,
    OvertureApiModule,
    Ng911ApiModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class ApiModule {}
