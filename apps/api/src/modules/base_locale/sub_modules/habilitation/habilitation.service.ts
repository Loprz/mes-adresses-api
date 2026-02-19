import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ObjectId } from 'mongodb';
import { MailerService } from '@nestjs-modules/mailer';

import {
  Habilitation,
  StatusHabilitationEnum,
  TypeStrategyEnum,
} from '@/shared/entities/habilitation.entity';
import { BaseLocale } from '@/shared/entities/base_locale.entity';
import { BaseLocaleService } from '../../base_locale.service';
import {
  getJurisdictionEmails,
  getJurisdictionName,
} from '@/shared/utils/fips.utils';
import { getApiUrl } from '@/shared/utils/mailer.utils';

@Injectable()
export class HabilitationService {
  private readonly PIN_CODE_LENGTH = 6;
  private readonly PIN_CODE_EXPIRATION_MINUTES = 10;
  private readonly MAX_PIN_ATTEMPTS = 5;

  constructor(
    @InjectRepository(Habilitation)
    private habilitationsRepository: Repository<Habilitation>,
    private readonly baseLocaleService: BaseLocaleService,
    private readonly mailerService: MailerService,
    private readonly logger: Logger,
  ) {}

  async findOne(habilitationId: string): Promise<Habilitation> {
    if (!ObjectId.isValid(habilitationId)) {
      throw new HttpException(
        'The authorization ID is invalid',
        HttpStatus.BAD_REQUEST,
      );
    }

    const habilitation = await this.habilitationsRepository.findOne({
      where: { id: habilitationId },
    });

    if (!habilitation) {
      throw new HttpException(
        `Authorization ${habilitationId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    return habilitation;
  }

  async isValid(habilitationId: string): Promise<boolean> {
    if (!ObjectId.isValid(habilitationId)) {
      throw new HttpException(
        'The authorization ID is invalid',
        HttpStatus.NOT_FOUND,
      );
    }

    const habilitation = await this.habilitationsRepository.findOne({
      where: { id: habilitationId },
    });

    if (!habilitation) {
      return false;
    }

    return habilitation.status === StatusHabilitationEnum.ACCEPTED;
  }

  async areValid(habilitationIds: string[]): Promise<Record<string, boolean>> {
    if (!habilitationIds || habilitationIds.length === 0) {
      return {};
    }

    if (
      habilitationIds.some(
        (habilitationId) => !ObjectId.isValid(habilitationId),
      )
    ) {
      throw new HttpException(
        'The authorization IDs are invalid',
        HttpStatus.NOT_FOUND,
      );
    }

    const habilitations = await this.habilitationsRepository
      .createQueryBuilder('h')
      .where('h.id IN (:...ids)', { ids: habilitationIds })
      .getMany();

    const acceptedIds = new Set(
      habilitations
        .filter((h) => h.status === StatusHabilitationEnum.ACCEPTED)
        .map((h) => h.id),
    );

    return habilitationIds.reduce(
      (index, id) => ({
        ...index,
        [id]: acceptedIds.has(id),
      }),
      {},
    );
  }

  async createOne(baseLocale: BaseLocale): Promise<Habilitation> {
    // If there is already an accepted habilitation, reject
    if (baseLocale.habilitationId) {
      try {
        const existing = await this.findOne(baseLocale.habilitationId);
        if (existing.status === StatusHabilitationEnum.ACCEPTED) {
          throw new HttpException(
            'This Local Address Base already has an authorization',
            HttpStatus.PRECONDITION_FAILED,
          );
        }
      } catch (err) {
        // If habilitation not found, that's fine — we'll create a new one
        if (err.status !== HttpStatus.NOT_FOUND) {
          throw err;
        }
      }
    }

    const habilitation = this.habilitationsRepository.create({
      balId: baseLocale.id,
      codeCommune: baseLocale.commune,
      emailCommune: '',
      status: StatusHabilitationEnum.PENDING,
      strategy: null,
    });

    const saved = await this.habilitationsRepository.save(habilitation);

    // Update the BaseLocale to point to this habilitation
    await this.baseLocaleService.updateHabilitation(baseLocale, saved);

    this.logger.log(
      `Created authorization ${saved.id} for LAB ${baseLocale.id} (jurisdiction ${baseLocale.commune})`,
      HabilitationService.name,
    );

    return saved;
  }

  async sendPinCode(habilitationId: string, email: string): Promise<void> {
    const habilitation = await this.findOne(habilitationId);

    if (habilitation.status !== StatusHabilitationEnum.PENDING) {
      throw new HttpException(
        'No pending authorization request',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    // Validate that the email is a registered jurisdiction email
    const registeredEmails = getJurisdictionEmails(habilitation.codeCommune);
    if (!registeredEmails.includes(email.toLowerCase())) {
      throw new HttpException(
        'This email is not a registered jurisdiction email for this FIPS code',
        HttpStatus.FORBIDDEN,
      );
    }

    // Generate PIN code
    const pinCode = this.generatePinCode();
    const pinCodeExpiration = new Date(
      Date.now() + this.PIN_CODE_EXPIRATION_MINUTES * 60 * 1000,
    );

    // Update habilitation with strategy
    habilitation.emailCommune = email;
    habilitation.strategy = {
      type: TypeStrategyEnum.EMAIL,
      pinCode,
      pinCodeExpiration,
      createdAt: new Date(),
      remainingAttempts: this.MAX_PIN_ATTEMPTS,
    };

    await this.habilitationsRepository.save(habilitation);

    // Send the PIN code email
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: 'National Address Platform — Verification Code',
        template: 'pin-code-verification',
        context: {
          pinCode,
          expirationMinutes: this.PIN_CODE_EXPIRATION_MINUTES,
          jurisdictionName:
            getJurisdictionName(habilitation.codeCommune) ||
            habilitation.codeCommune,
          apiUrl: getApiUrl(),
        },
      });

      this.logger.log(
        `PIN code sent to ${email} for authorization ${habilitationId}`,
        HabilitationService.name,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send PIN code email to ${email}`,
        error.message,
        HabilitationService.name,
      );
      throw new HttpException(
        'Failed to send verification email. Please try again.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async validatePinCode(
    habilitationId: string,
    code: string,
  ): Promise<Habilitation> {
    const habilitation = await this.findOne(habilitationId);

    if (habilitation.status !== StatusHabilitationEnum.PENDING) {
      throw new HttpException(
        'No pending authorization request',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    if (!habilitation.strategy || !habilitation.strategy.pinCode) {
      throw new HttpException(
        'No PIN code has been sent yet',
        HttpStatus.PRECONDITION_FAILED,
      );
    }

    // Check expiration
    if (
      habilitation.strategy.pinCodeExpiration &&
      new Date(habilitation.strategy.pinCodeExpiration) < new Date()
    ) {
      throw new HttpException(
        'The PIN code has expired. Please request a new one.',
        HttpStatus.GONE,
      );
    }

    // Check remaining attempts
    if (
      habilitation.strategy.remainingAttempts !== undefined &&
      habilitation.strategy.remainingAttempts <= 0
    ) {
      habilitation.status = StatusHabilitationEnum.REJECTED;
      habilitation.rejectedAt = new Date();
      await this.habilitationsRepository.save(habilitation);

      throw new HttpException(
        'Maximum number of attempts reached. Authorization rejected.',
        HttpStatus.FORBIDDEN,
      );
    }

    // Validate PIN code
    if (habilitation.strategy.pinCode !== code) {
      // Decrement remaining attempts
      habilitation.strategy = {
        ...habilitation.strategy,
        remainingAttempts:
          (habilitation.strategy.remainingAttempts ?? this.MAX_PIN_ATTEMPTS) -
          1,
      };
      await this.habilitationsRepository.save(habilitation);

      const remaining = habilitation.strategy.remainingAttempts;
      throw new HttpException(
        `Invalid PIN code. ${remaining} attempt${
          remaining === 1 ? '' : 's'
        } remaining.`,
        HttpStatus.FORBIDDEN,
      );
    }

    // PIN is correct — accept the habilitation
    habilitation.status = StatusHabilitationEnum.ACCEPTED;
    habilitation.acceptedAt = new Date();
    habilitation.strategy = {
      ...habilitation.strategy,
      pinCode: undefined, // Clear the PIN for security
    };
    const saved = await this.habilitationsRepository.save(habilitation);

    this.logger.log(
      `Authorization ${habilitationId} accepted`,
      HabilitationService.name,
    );

    return saved;
  }

  /**
   * Get the registered jurisdiction emails for a given FIPS code.
   */
  getRegisteredEmails(fipsCode: string): string[] {
    return getJurisdictionEmails(fipsCode);
  }

  /**
   * Generate a random 6-digit PIN code.
   */
  private generatePinCode(): string {
    const min = Math.pow(10, this.PIN_CODE_LENGTH - 1);
    const max = Math.pow(10, this.PIN_CODE_LENGTH) - 1;
    return String(Math.floor(Math.random() * (max - min + 1)) + min);
  }
}
