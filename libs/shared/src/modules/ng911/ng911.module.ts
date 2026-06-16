import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaseLocale } from '../../entities/base_locale.entity';
import { Numero } from '../../entities/numero.entity';
import { Voie } from '../../entities/voie.entity';
import { NumeroNg911 } from '../../entities/numero_ng911.entity';
import { Ng911Service } from './ng911.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BaseLocale, Numero, Voie, NumeroNg911]),
  ],
  providers: [Ng911Service],
  exports: [Ng911Service],
})
export class Ng911Module {}
