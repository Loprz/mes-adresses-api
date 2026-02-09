import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaseLocale } from '../../entities/base_locale.entity';
import { Numero } from '../../entities/numero.entity';
import { Voie } from '../../entities/voie.entity';
import { Toponyme } from '../../entities/toponyme.entity';
import { Position } from '../../entities/position.entity';
import { OvertureService } from './overture.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BaseLocale, Numero, Voie, Toponyme, Position]),
  ],
  providers: [OvertureService],
  exports: [OvertureService],
})
export class OvertureModule {}
