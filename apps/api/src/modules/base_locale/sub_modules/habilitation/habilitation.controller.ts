import {
  Controller,
  UseGuards,
  Res,
  Req,
  HttpStatus,
  Body,
  Get,
  Post,
} from '@nestjs/common';
import { Response } from 'express';
import {
  ApiParam,
  ApiTags,
  ApiResponse,
  ApiBody,
  ApiOperation,
  ApiBearerAuth,
} from '@nestjs/swagger';

import { Habilitation } from '@/shared/entities/habilitation.entity';

import { CustomRequest } from '@/lib/types/request.type';
import { AdminGuard } from '@/lib/guards/admin.guard';
import { HabilitationService } from './habilitation.service';
import { ValidatePinCodeDTO } from './dto/validate-pin-code.dto';
import { HabilitationDTO } from './dto/habilitation.dto';
import { SendPinCodeDTO } from './dto/send-pin-code.dto';

@ApiTags('habilitation')
@Controller('')
export class HabilitationController {
  constructor(private habilitationService: HabilitationService) {}

  @Get('/bases-locales/:baseLocaleId/habilitation/is-valid')
  @ApiOperation({
    summary: 'Check if authorization is valid',
    operationId: 'findIsValid',
  })
  @ApiParam({ name: 'baseLocaleId', required: true, type: String })
  @ApiResponse({ status: 200, type: Boolean })
  async getHabilitationIsValid(
    @Req() req: CustomRequest,
    @Res() res: Response,
  ) {
    try {
      const isValid: boolean = await this.habilitationService.isValid(
        req.baseLocale.habilitationId,
      );
      res.status(HttpStatus.OK).json(isValid);
    } catch (err) {
      res.status(HttpStatus.OK).json(false);
    }
  }

  @Get('/bases-locales/:baseLocaleId/habilitation')
  @ApiOperation({
    summary: 'Get authorization details',
    operationId: 'findHabilitation',
  })
  @ApiParam({ name: 'baseLocaleId', required: true, type: String })
  @ApiResponse({ status: 200, type: HabilitationDTO })
  @ApiBearerAuth('admin-token')
  @UseGuards(AdminGuard)
  async getHabilitation(@Req() req: CustomRequest, @Res() res: Response) {
    const result: Habilitation = await this.habilitationService.findOne(
      req.baseLocale.habilitationId,
    );
    res.status(HttpStatus.OK).json(result);
  }

  @Post('/bases-locales/:baseLocaleId/habilitation')
  @ApiOperation({
    summary: 'Create authorization',
    operationId: 'createHabilitation',
  })
  @ApiParam({ name: 'baseLocaleId', required: true, type: String })
  @ApiResponse({ status: 201, type: HabilitationDTO })
  @ApiBearerAuth('admin-token')
  @UseGuards(AdminGuard)
  async createHabilitation(@Req() req: CustomRequest, @Res() res: Response) {
    const habilitation = await this.habilitationService.createOne(
      req.baseLocale,
    );

    res.send(habilitation);
  }

  @Get('/bases-locales/:baseLocaleId/habilitation/emails')
  @ApiOperation({
    summary: 'Get registered jurisdiction emails for this LAB',
    operationId: 'getRegisteredEmails',
  })
  @ApiParam({ name: 'baseLocaleId', required: true, type: String })
  @ApiResponse({ status: 200, type: [String] })
  @ApiBearerAuth('admin-token')
  @UseGuards(AdminGuard)
  async getRegisteredEmails(@Req() req: CustomRequest, @Res() res: Response) {
    const emails = this.habilitationService.getRegisteredEmails(
      req.baseLocale.commune,
    );
    res.status(HttpStatus.OK).json(emails);
  }

  @Post('/bases-locales/:baseLocaleId/habilitation/email/send-pin-code')
  @ApiOperation({
    summary: 'Send PIN code for authorization',
    operationId: 'sendPinCodeHabilitation',
  })
  @ApiParam({ name: 'baseLocaleId', required: true, type: String })
  @ApiBody({ type: SendPinCodeDTO, required: true })
  @ApiBearerAuth('admin-token')
  @UseGuards(AdminGuard)
  async sendPinCode(
    @Req() req: CustomRequest,
    @Body() { email }: SendPinCodeDTO,
    @Res() res: Response,
  ) {
    await this.habilitationService.sendPinCode(
      req.baseLocale.habilitationId,
      email,
    );
    res.sendStatus(HttpStatus.OK);
  }

  @Post('/bases-locales/:baseLocaleId/habilitation/email/validate-pin-code')
  @ApiOperation({
    summary: 'Validate PIN code for authorization',
    operationId: 'validatePinCodeHabilitation',
  })
  @ApiParam({ name: 'baseLocaleId', required: true, type: String })
  @ApiBody({ type: ValidatePinCodeDTO, required: true })
  @ApiResponse({ status: 200 })
  @ApiBearerAuth('admin-token')
  @UseGuards(AdminGuard)
  async validatePinCode(
    @Req() req: CustomRequest,
    @Body() body: ValidatePinCodeDTO,
    @Res() res: Response,
  ) {
    await this.habilitationService.validatePinCode(
      req.baseLocale.habilitationId,
      body.code,
    );
    res.sendStatus(HttpStatus.OK);
  }
}
