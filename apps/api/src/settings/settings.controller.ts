import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../common/types/auth.types';
import type { ExperienceTitleMode } from '../generations/experience-title-mode';

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  /** Master initial prompt list */
  @Get('prompts')
  @Roles(UserRole.MASTER)
  getPrompts() {
    return this.settingsService.getMasterPrompts();
  }

  @Post('prompts')
  @Roles(UserRole.MASTER)
  createPrompt(@Body('content') content: string) {
    return this.settingsService.createMasterPrompt(content);
  }

  @Post('prompts/:id/publish')
  @Roles(UserRole.MASTER)
  publishPrompt(@Param('id') id: string) {
    return this.settingsService.publishMasterPrompt(id);
  }

  @Patch('prompts/:id')
  @Roles(UserRole.MASTER)
  updatePrompt(
    @Param('id') id: string,
    @Body('content') content: string,
    @Body('name') name?: string,
  ) {
    return this.settingsService.updateMasterPrompt(id, content, name);
  }

  @Delete('prompts/:id')
  @Roles(UserRole.MASTER)
  deletePrompt(@Param('id') id: string) {
    return this.settingsService.deleteMasterPrompt(id);
  }

  /** Prompt library. Bidders cannot add or edit prompts. */
  @Get('prompt-library')
  @Roles(UserRole.ADMIN)
  listPromptLibrary(@Req() req: { user: AuthUser }, @Query('scope') scope?: string) {
    if (scope === 'assign') return this.settingsService.listAssignablePrompts(req.user);
    return this.settingsService.listManagedPrompts(req.user);
  }

  @Post('prompt-library')
  @Roles(UserRole.ADMIN)
  createLibraryPrompt(
    @Body() body: { name: string; content: string; experienceTitleMode?: ExperienceTitleMode },
    @Req() req: { user: AuthUser },
  ) {
    return this.settingsService.createLibraryPrompt(req.user, body);
  }

  @Patch('prompt-library/:id')
  @Roles(UserRole.ADMIN)
  updateLibraryPrompt(
    @Param('id') id: string,
    @Body() body: { name?: string; content?: string; experienceTitleMode?: ExperienceTitleMode },
    @Req() req: { user: AuthUser },
  ) {
    return this.settingsService.updateLibraryPrompt(req.user, id, body);
  }

  @Delete('prompt-library/:id')
  @Roles(UserRole.ADMIN)
  deleteLibraryPrompt(@Param('id') id: string, @Req() req: { user: AuthUser }) {
    return this.settingsService.deleteLibraryPrompt(req.user, id);
  }

  @Get('prompt-mode')
  @Roles(UserRole.ADMIN)
  getPromptMode(@Req() req: { user: AuthUser }) {
    return this.settingsService.getPromptAssignmentMode(req.user).then((mode) => ({ mode }));
  }

  @Patch('prompt-mode')
  @Roles(UserRole.ADMIN)
  setPromptMode(@Body('mode') mode: 'user' | 'profile', @Req() req: { user: AuthUser }) {
    return this.settingsService.setPromptAssignmentMode(req.user, mode);
  }

  /** Effective / my prompt for Admin, Bidder (and Master for convenience) */
  @Get('my-prompt')
  getMyPrompt(@Req() req: { user: AuthUser }) {
    return this.settingsService.getMyPromptSettings(req.user);
  }

  @Patch('my-prompt')
  @Roles(UserRole.ADMIN)
  updateMyPrompt(
    @Body()
    body: {
      mode?: 'user' | 'profile';
      content?: string;
      resetToDefault?: boolean;
    },
    @Req() req: { user: AuthUser },
  ) {
    return this.settingsService.updateMyPromptSettings(req.user, body);
  }

  @Get('ai')
  @Roles(UserRole.MASTER)
  getAiSettings() {
    return this.settingsService.getAiSettings();
  }

  @Patch('ai')
  @Roles(UserRole.MASTER)
  updateAiSettings(@Body() body: { apiKey?: string; model?: string }) {
    return this.settingsService.updateAiSettings(body);
  }

  @Get('answer-prompt')
  @Roles(UserRole.ADMIN)
  getAnswerPrompt() {
    return this.settingsService.getAnswerPrompt().then((prompt) => ({ prompt }));
  }

  @Patch('answer-prompt')
  @Roles(UserRole.ADMIN)
  setAnswerPrompt(@Body('prompt') prompt: string) {
    return this.settingsService.setAnswerPrompt(prompt).then((value) => ({ prompt: value }));
  }
}
