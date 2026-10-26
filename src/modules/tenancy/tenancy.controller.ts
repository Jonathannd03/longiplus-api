import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Inject,
  BadRequestException,
} from '@nestjs/common';
import { RolesGuard } from '../identity/roles.guard.js';
import { Roles, CurrentUser, Public } from '../identity/auth.decorator.js';
import { SchoolService } from './school.service.js';
import { PayoutAccountService } from './payout-account.service.js';
import { MembershipService } from './membership.service.js';
import { AuditService } from '../identity/audit.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { withSchoolContext } from '../../db/client.js';
import { SMS_SENDER, type SmsSender } from '../notifications/sms-sender.interface.js';
import type { AuthenticatedUser } from '../identity/authenticated-user.interface.js';

interface UpdateSchoolDto {
  name?: string;
  province?: string;
  city?: string;
  address?: string;
  contactPhone?: string;
  logoRef?: string;
  acceptCdfForUsd?: boolean;
  cdfPerUsdRate?: string;
}

interface CreatePayoutAccountDto {
  kind: 'mobile_money' | 'bank';
  operator?: string;
  numberMasked: string;
}

interface InviteMemberDto {
  email: string;
  role: 'director' | 'bursar' | 'secretary' | 'teacher' | 'class_teacher';
  keycloakUserId?: string;
}

interface PhoneInviteDto {
  phone: string;
  role: 'teacher' | 'class_teacher' | 'secretary';
}

interface VerifyInviteDto {
  phone: string;
  code: string;
}

@Controller()
@UseGuards(RolesGuard)
export class TenancyController {
  constructor(
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    private readonly schoolService: SchoolService,
    private readonly payoutAccountService: PayoutAccountService,
    private readonly membershipService: MembershipService,
    private readonly auditService: AuditService,
    private readonly outboxService: OutboxService,
  ) {}

  @Get('school')
  async getSchool(@CurrentUser() user: AuthenticatedUser) {
    return this.schoolService.findById(user.schoolId);
  }

  @Patch('school')
  @Roles('owner', 'director')
  async updateSchool(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateSchoolDto) {
    return withSchoolContext(user.schoolId, async (tx) => {
      const updates: Parameters<typeof this.schoolService.updateProfile>[2] = {};
      if (dto.name !== undefined) updates.name = dto.name;
      if (dto.province !== undefined) updates.province = dto.province;
      if (dto.city !== undefined) updates.city = dto.city;
      if (dto.address !== undefined) updates.address = dto.address;
      if (dto.contactPhone !== undefined) updates.contactPhone = dto.contactPhone;
      if (dto.logoRef !== undefined) updates.logoRef = dto.logoRef;
      if (dto.acceptCdfForUsd !== undefined) updates.acceptCdfForUsd = dto.acceptCdfForUsd;
      if (dto.cdfPerUsdRate !== undefined) updates.cdfPerUsdRate = BigInt(dto.cdfPerUsdRate);
      const result = await this.schoolService.updateProfile(tx, user.schoolId, updates);
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'school.profile_updated',
        entity: 'school',
        entityId: user.schoolId,
        after: dto as Record<string, unknown>,
      });
      return result;
    });
  }

  @Post('payout-accounts')
  @Roles('owner')
  async createPayoutAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePayoutAccountDto,
  ) {
    return withSchoolContext(user.schoolId, async (tx) => {
      const account = await this.payoutAccountService.create(tx, user.schoolId, dto);
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'payout_account.created',
        entity: 'payout_account',
        entityId: account.id,
        after: { kind: dto.kind, numberMasked: dto.numberMasked },
      });
      return account;
    });
  }

  @Get('payout-accounts')
  @Roles('owner', 'director')
  async listPayoutAccounts(@CurrentUser() user: AuthenticatedUser) {
    return this.payoutAccountService.findBySchool(user.schoolId);
  }

  @Post('payout-accounts/:id/approve')
  @Roles('owner')
  @HttpCode(HttpStatus.OK)
  async approvePayoutAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return withSchoolContext(user.schoolId, async (tx) => {
      const account = await this.payoutAccountService.approve(tx, id, user.keycloakUserId);
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'payout_account.approved',
        entity: 'payout_account',
        entityId: id,
      });
      return account;
    });
  }

  @Post('memberships/invite')
  @Roles('owner', 'director')
  async inviteMember(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InviteMemberDto,
  ) {
    return withSchoolContext(user.schoolId, async (tx) => {
      const member = await this.membershipService.invite(tx, user.schoolId, dto);
      await this.auditService.writeEvent(tx, {
        schoolId: user.schoolId,
        actor: user.keycloakUserId,
        action: 'user.invited',
        entity: 'membership',
        entityId: member.id,
        after: { email: dto.email, role: dto.role },
      });
      await this.outboxService.write(tx, {
        topic: 'user.invited',
        payload: { membershipId: member.id, schoolId: user.schoolId, email: dto.email, role: dto.role },
      });
      return member;
    });
  }

  @Get('memberships')
  @Roles('owner', 'director')
  async listMembers(@CurrentUser() user: AuthenticatedUser) {
    return this.membershipService.findBySchool(user.schoolId);
  }

  /** FR-11: invite a teacher by phone number */
  @Post('memberships/phone-invite')
  @Roles('owner', 'director')
  @HttpCode(HttpStatus.CREATED)
  async phoneInvite(@CurrentUser() user: AuthenticatedUser, @Body() dto: PhoneInviteDto) {
    if (!dto.phone?.trim()) throw new BadRequestException('phone required');
    if (!dto.role) throw new BadRequestException('role required');
    const { id, code } = await withSchoolContext(user.schoolId, (tx) =>
      this.membershipService.phoneInvite(tx, user.schoolId, dto),
    );
    const msg = `LongiPlus : Vous êtes invité(e) à rejoindre l'équipe de l'école. Code d'activation : ${code}. Valable 48h.`;
    await this.sms.send(dto.phone.trim(), msg).catch((err: unknown) =>
      console.error('FR-11 phone invite SMS error', err),
    );
    return { id };
  }

  /** FR-17: teacher activates their account with the SMS code */
  @Post('memberships/verify-invite')
  @Public()
  @HttpCode(HttpStatus.OK)
  async verifyInvite(@Body() dto: VerifyInviteDto) {
    if (!dto.phone?.trim()) throw new BadRequestException('phone required');
    if (!dto.code?.trim()) throw new BadRequestException('code required');
    return this.membershipService.verifyInvite(dto.phone.trim(), dto.code.trim());
  }
}
